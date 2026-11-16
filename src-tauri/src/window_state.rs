//! Native minimization completion, independent of the rendering backend and focus events.
use tauri::{Emitter, Manager};

pub const MINIMIZED_EVENT: &str = "alwith:window-minimized";

fn publish(window: &tauri::WebviewWindow, minimized: bool) {
    if let Err(error) = window.emit_to(window.label(), MINIMIZED_EVENT, minimized) {
        log::error!("Cannot publish native window minimization: {error}");
    }
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
    use objc2_foundation::{NSNotificationCenter, NSObject};
    use std::sync::OnceLock;
    static WINDOW: OnceLock<tauri::WebviewWindow> = OnceLock::new();

    pub fn install(window: tauri::WebviewWindow) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        WINDOW.set(window).map_err(|_| "Window state observer already installed")?;
        let mut builder = ClassBuilder::new(c"AlwithWindowStateObserver", NSObject::class())
            .ok_or("Cannot create window state observer")?;
        // The main window and its observer are retained for the process lifetime.
        // AppKit posts these after completion, including for unfocused windows.
        unsafe {
            builder.add_method(sel!(didMinimize:), minimized as extern "C-unwind" fn(_, _, _));
            builder.add_method(sel!(didRestore:), restored as extern "C-unwind" fn(_, _, _));
            let class = builder.register();
            let observer: *mut AnyObject = msg_send![class, new];
            if observer.is_null() {
                return Err("Cannot allocate window state observer".into());
            }
            let center = NSNotificationCenter::defaultCenter();
            for (name, selector) in [
                (objc2_app_kit::NSWindowDidMiniaturizeNotification, sel!(didMinimize:)),
                (objc2_app_kit::NSWindowDidDeminiaturizeNotification, sel!(didRestore:)),
            ] {
                let _: () = msg_send![&*center, addObserver: observer, selector: selector, name: name, object: pointer as *mut AnyObject];
            }
        }
        Ok(())
    }
    extern "C-unwind" fn minimized(_: &AnyObject, _: Sel, _: *mut AnyObject) {
        publish(WINDOW.get().expect("Window observer installed"), true);
    }
    extern "C-unwind" fn restored(_: &AnyObject, _: Sel, _: *mut AnyObject) {
        publish(WINDOW.get().expect("Window observer installed"), false);
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
            WindowsAndMessaging::{SIZE_MAXIMIZED, SIZE_MINIMIZED, SIZE_RESTORED, WM_NCDESTROY, WM_SIZE},
        },
    };
    static WINDOW: OnceLock<tauri::WebviewWindow> = OnceLock::new();
    const SUBCLASS: usize = 0x414c5753;

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
        if message == WM_SIZE {
            match wparam as u32 {
                SIZE_MINIMIZED => publish(WINDOW.get().expect("Window observer installed"), true),
                SIZE_RESTORED | SIZE_MAXIMIZED => publish(WINDOW.get().expect("Window observer installed"), false),
                _ => {}
            }
        } else if message == WM_NCDESTROY {
            unsafe { RemoveWindowSubclass(hwnd, Some(changed), SUBCLASS) };
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }
}
