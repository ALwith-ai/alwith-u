use tauri::{
    Manager, WebviewWindow,
    plugin::{Builder, TauriPlugin},
};

#[tauri::command]
pub async fn present_chat_window(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window may present itself".into());
    }
    super::prepare(&window).await?;
    #[cfg(target_os = "macos")]
    {
        let handle = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    let pointer = handle.ns_window().map_err(|e| e.to_string())?;
                    // SAFETY: prepared, retained window on AppKit's main thread.
                    let native = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                    native.orderFrontRegardless();
                    native.makeKeyWindow();
                    Ok::<(), String>(())
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_chat_window(
    window: WebviewWindow, direction: String, x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window may resize itself".into());
    }
    super::resize::resize(&window, direction, x, y, width, height).await
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("chat-window")
        .setup(|app, _| {
            #[cfg(target_os = "macos")]
            {
                app.plugin(tauri_nspanel::init())?;
                super::install_input_observer();
                observer::install(app);
            }
            let _ = app;
            Ok(())
        })
        .build()
}

#[cfg(target_os = "macos")]
mod observer {
    use super::*;
    use objc2::{
        ClassType, msg_send,
        runtime::{AnyObject, ClassBuilder, Sel},
        sel,
    };
    use objc2_app_kit::{NSPanel, NSWindow, NSWorkspace};
    use objc2_foundation::{NSNotificationCenter, NSObject, NSObjectProtocol};
    use std::sync::OnceLock;
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn install(app: &tauri::AppHandle) {
        APP.set(app.clone()).expect("Window observer installed once");
        let mut builder =
            ClassBuilder::new(c"AlwithChatWindowObserver", NSObject::class()).expect("Window observer class");
        // SAFETY: selector and callback agree; observer lives until process exit.
        unsafe {
            builder.add_method(sel!(restoreChatWindows:), restore as extern "C-unwind" fn(_, _, _));
            let class = builder.register();
            let observer: *mut AnyObject = msg_send![class, new];
            assert!(!observer.is_null(), "Window observer allocation");
            let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
            for name in [
                objc2_app_kit::NSWorkspaceDidWakeNotification,
                objc2_app_kit::NSWorkspaceActiveSpaceDidChangeNotification,
            ] {
                let _: () = msg_send![&*workspace, addObserver: observer, selector: sel!(restoreChatWindows:), name: name, object: std::ptr::null::<AnyObject>()];
            }
            let center = NSNotificationCenter::defaultCenter();
            let _: () = msg_send![&*center, addObserver: observer, selector: sel!(restoreChatWindows:), name: objc2_app_kit::NSApplicationDidChangeScreenParametersNotification, object: std::ptr::null::<AnyObject>()];
        }
    }
    extern "C-unwind" fn restore(_observer: &AnyObject, _selector: Sel, _notification: *mut AnyObject) {
        let app = APP.get().expect("Window observer installed");
        let handle = app.clone();
        app.run_on_main_thread(move || {
            for (label, window) in handle.webview_windows() {
                if label != "chat" {
                    continue;
                }
                let pointer = window.ns_window().expect("Live chat window has NSWindow");
                // SAFETY: main thread holds the live window.
                let native = unsafe { &*(pointer as *const NSWindow) };
                if native.isVisible() && native.isKindOfClass(NSPanel::class()) {
                    crate::chat_window::restore(native);
                    native.orderFrontRegardless();
                }
            }
            crate::chat_window::update_input_candidates();
        })
        .expect("Restore chat window after environment change");
    }
}
