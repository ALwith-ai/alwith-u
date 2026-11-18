//! Native main-window visibility, independent of WebView lifecycle and focus.
use tauri::{Emitter, Manager};

const HIDDEN_EVENT: &str = "alwith:window-hidden";

fn publish(window: &tauri::WebviewWindow, hidden: bool) {
    if let Err(error) = window.emit_to(window.label(), HIDDEN_EVENT, hidden) {
        log::error!("Cannot publish native window visibility: {error}");
    }
}

pub fn publish_current(window: &tauri::WebviewWindow) {
    let target = window.clone();
    if let Err(error) = window.run_on_main_thread(move || match platform::hidden(&target) {
        Ok(hidden) => publish(&target, hidden),
        Err(error) => log::error!("Cannot read native window visibility: {error}"),
    }) {
        log::error!("Cannot schedule native window visibility update: {error}");
    }
}

#[tauri::command]
pub async fn main_window_hidden(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Only the main window may read its visibility".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = send.send(platform::hidden(&target));
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("Main window unavailable")?;
    platform::install(window)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::{
        ClassType, msg_send,
        runtime::{AnyObject, ClassBuilder, Sel},
        sel,
    };
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSNotificationCenter, NSObject};
    use std::sync::OnceLock;
    static WINDOW: OnceLock<tauri::WebviewWindow> = OnceLock::new();

    fn is_hidden(window: &NSWindow) -> bool {
        window.isMiniaturized() || !window.isVisible()
    }

    pub fn hidden(window: &tauri::WebviewWindow) -> Result<bool, String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // The IPC snapshot reads the live AppKit window on the main thread.
        Ok(is_hidden(unsafe { &*pointer.cast::<NSWindow>() }))
    }

    pub fn install(window: tauri::WebviewWindow) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        WINDOW.set(window).map_err(|_| "Window state observer already installed")?;
        let mut builder = ClassBuilder::new(c"AlwithWindowStateObserver", NSObject::class())
            .ok_or("Cannot create window state observer")?;
        // The main window and its observer are retained for the process lifetime.
        // AppKit posts these after completion, including for unfocused windows.
        unsafe {
            builder.add_method(sel!(windowChanged:), changed as extern "C-unwind" fn(_, _, _));
            let class = builder.register();
            let observer: *mut AnyObject = msg_send![class, new];
            if observer.is_null() {
                return Err("Cannot allocate window state observer".into());
            }
            let center = NSNotificationCenter::defaultCenter();
            for name in [
                objc2_app_kit::NSWindowDidMiniaturizeNotification,
                objc2_app_kit::NSWindowDidDeminiaturizeNotification,
                objc2_app_kit::NSWindowDidChangeOcclusionStateNotification,
            ] {
                let _: () = msg_send![&*center, addObserver: observer, selector: sel!(windowChanged:), name: name, object: pointer as *mut AnyObject];
            }
        }
        Ok(())
    }
    extern "C-unwind" fn changed(_: &AnyObject, _: Sel, notification: &AnyObject) {
        let window = WINDOW.get().expect("Window observer installed");
        // AppKit can call the observer during a window operation. Read the notification's
        // window directly without asking the runtime for the handle again.
        let native: *const NSWindow = unsafe { msg_send![notification, object] };
        publish(window, is_hidden(unsafe { &*native }));
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::OnceLock;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{IsIconic, IsWindowVisible, WM_NCDESTROY, WM_SIZE, WM_WINDOWPOSCHANGED},
        },
    };
    static WINDOW: OnceLock<tauri::WebviewWindow> = OnceLock::new();
    const SUBCLASS: usize = 0x414c5753;

    fn is_hidden(hwnd: HWND) -> bool {
        unsafe { IsIconic(hwnd) != 0 || IsWindowVisible(hwnd) == 0 }
    }

    pub fn hidden(window: &tauri::WebviewWindow) -> Result<bool, String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        Ok(is_hidden(hwnd))
    }

    pub fn install(window: tauri::WebviewWindow) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
        WINDOW.set(window).map_err(|_| "Window state observer already installed")?;
        // WM_SIZE carries completed native state, including non-focused minimization.
        if unsafe { SetWindowSubclass(hwnd, Some(changed), SUBCLASS, 0) } == 0 {
            return Err("Cannot install native window state observer".into());
        }
        Ok(())
    }
    unsafe extern "system" fn changed(
        hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _: usize, _: usize,
    ) -> LRESULT {
        if message == WM_NCDESTROY {
            unsafe { RemoveWindowSubclass(hwnd, Some(changed), SUBCLASS) };
        }
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if matches!(message, WM_SIZE | WM_WINDOWPOSCHANGED) {
            publish(WINDOW.get().expect("Window observer installed"), is_hidden(hwnd));
        }
        result
    }
}
