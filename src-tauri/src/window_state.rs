//! Native chat surface visibility, independent of WebView lifecycle and focus.
use tauri::{Emitter, Manager};

const HIDDEN_EVENT: &str = "alwith:window-hidden";
const CHAT_HIDDEN_EVENT: &str = "alwith:chat-window-hidden";

fn publish(window: &tauri::WebviewWindow, hidden: bool) {
    let event = if window.label() == "chat" { CHAT_HIDDEN_EVENT } else { HIDDEN_EVENT };
    if let Err(error) = window.emit_to("main", event, hidden) {
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
    read_hidden(window).await
}

#[tauri::command]
pub async fn chat_window_hidden(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Only the main window may read chat visibility".into());
    }
    let Some(chat) = window.app_handle().get_webview_window("chat") else { return Ok(true) };
    read_hidden(chat).await
}

async fn read_hidden(window: tauri::WebviewWindow) -> Result<bool, String> {
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

pub async fn watch_chat(window: &tauri::WebviewWindow) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = send.send(platform::install(target));
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

pub fn chat_closed(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    platform::forget_chat();
    if let Err(error) = app.emit_to("main", CHAT_HIDDEN_EVENT, true) {
        log::error!("Cannot publish chat closure: {error}");
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::{
        ClassType, msg_send,
        runtime::{AnyObject, ClassBuilder, Sel},
        sel,
    };
    use objc2_app_kit::{NSWindow, NSWindowOcclusionState};
    use objc2_foundation::{NSNotificationCenter, NSObject};
    use std::{cell::RefCell, collections::HashMap};
    thread_local! {
        static WINDOWS: RefCell<HashMap<usize, tauri::WebviewWindow>> = RefCell::new(HashMap::new());
    }

    fn is_hidden(window: &NSWindow) -> bool {
        window.isMiniaturized()
            || !window.isVisible()
            || !window.occlusionState().contains(NSWindowOcclusionState::Visible)
    }

    pub fn hidden(window: &tauri::WebviewWindow) -> Result<bool, String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // The IPC snapshot reads the live AppKit window on the main thread.
        Ok(is_hidden(unsafe { &*pointer.cast::<NSWindow>() }))
    }

    pub fn install(window: tauri::WebviewWindow) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        let main = window.label() == "main";
        WINDOWS.with_borrow_mut(|windows| windows.insert(pointer as usize, window));
        if !main {
            return Ok(());
        }
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
                let _: () = msg_send![&*center, addObserver: observer, selector: sel!(windowChanged:), name: name, object: std::ptr::null::<AnyObject>()];
            }
        }
        Ok(())
    }
    extern "C-unwind" fn changed(_: &AnyObject, _: Sel, notification: &AnyObject) {
        // AppKit can call the observer during a window operation. Read the notification's
        // window directly without asking the runtime for the handle again.
        let native: *const NSWindow = unsafe { msg_send![notification, object] };
        if let Some(window) = WINDOWS.with_borrow(|windows| windows.get(&(native as usize)).cloned()) {
            publish(&window, is_hidden(unsafe { &*native }));
        }
    }
    pub fn forget_chat() {
        WINDOWS.with_borrow_mut(|windows| windows.retain(|_, window| window.label() != "chat"));
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{LazyLock, Mutex},
    };
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{IsIconic, IsWindowVisible, WM_NCDESTROY, WM_SIZE, WM_WINDOWPOSCHANGED},
        },
    };
    static WINDOWS: LazyLock<Mutex<HashMap<usize, tauri::WebviewWindow>>> = LazyLock::new(Mutex::default);
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
        if WINDOWS.lock().expect("Window state lock").contains_key(&(hwnd as usize)) {
            return Ok(());
        }
        // WM_SIZE carries completed native state, including non-focused minimization.
        if unsafe { SetWindowSubclass(hwnd, Some(changed), SUBCLASS, 0) } == 0 {
            return Err("Cannot install native window state observer".into());
        }
        WINDOWS.lock().expect("Window state lock").insert(hwnd as usize, window);
        Ok(())
    }
    unsafe extern "system" fn changed(
        hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _: usize, _: usize,
    ) -> LRESULT {
        if message == WM_NCDESTROY {
            WINDOWS.lock().expect("Window state lock").remove(&(hwnd as usize));
            unsafe { RemoveWindowSubclass(hwnd, Some(changed), SUBCLASS) };
        }
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if matches!(message, WM_SIZE | WM_WINDOWPOSCHANGED) {
            let window = WINDOWS.lock().expect("Window state lock").get(&(hwnd as usize)).cloned();
            if let Some(window) = window {
                publish(&window, is_hidden(hwnd));
            }
        }
        result
    }
}
