use tauri::{
    Manager, WebviewWindow,
    plugin::{Builder, TauriPlugin},
};

#[tauri3_specta::command]
pub async fn present_chat_window(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window may present itself".into());
    }
    crate::window::ensure_open(window.app_handle())?;
    super::prepare(&window).await?;
    #[cfg(target_os = "macos")]
    {
        let handle = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    crate::window::ensure_open(handle.app_handle())?;
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
        crate::window::ensure_open(window.app_handle())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri3_specta::command]
pub async fn resize_chat_window(
    window: WebviewWindow, direction: String, x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window may resize itself".into());
    }
    super::resize::resize(&window, direction, x, y, width, height).await
}

#[cfg(target_os = "macos")]
const BACKDROP: tauri::window::Effect = tauri::window::Effect::LiquidGlassRegular;
#[cfg(not(target_os = "macos"))]
const BACKDROP: tauri::window::Effect = tauri::window::Effect::Acrylic;

/// Applies the chat window's transparent appearance: Liquid Glass on macOS, Acrylic on Windows.
/// A corner radius in native points enables it; `None` restores the opaque appearance.
///
/// While the backdrop is on, the window is pinned dark and has no native shadow: the system draws
/// that shadow for the full window rectangle once a backdrop view is present, which shows as a
/// square frame around the rounded glass. Opaque content shapes the shadow correctly by itself.
#[tauri3_specta::command]
pub async fn set_chat_window_backdrop(window: WebviewWindow, corner_radius: Option<f64>) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("Only the chat window may change its backdrop".into());
    }
    if corner_radius.is_some_and(|radius| !radius.is_finite() || radius < 0.0) {
        return Err("The chat window corner radius must be finite and nonnegative".into());
    }
    let transparent = corner_radius.is_some();
    let effects =
        corner_radius.map(|radius| tauri::window::EffectsBuilder::new().effect(BACKDROP).radius(radius).build());
    window.set_effects(effects).map_err(|error| error.to_string())?;
    window.set_shadow(!transparent).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let handle = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = send.send(crate::panel::pin_dark_appearance(&handle, transparent));
            })
            .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())??;
    }
    Ok(())
}

pub fn init() -> TauriPlugin<tauri::DynRuntime> {
    Builder::new("chat-window")
        .setup(|app, _| {
            #[cfg(target_os = "macos")]
            {
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
        if let Err(error) = app.run_on_main_thread(move || {
            if crate::window::is_closing(&handle) {
                return;
            }
            let mut vibemon_restored = false;
            // Child layout must use the repaired parent frame, never HashMap iteration order.
            for label in ["chat", "vibemon", "bubble-menu-vibemon"] {
                if label == "bubble-menu-vibemon" && !vibemon_restored {
                    continue;
                }
                let Some(window) = handle.get_webview_window(label) else { continue };
                match restore_window(&window) {
                    Ok(restored) => {
                        if label == "vibemon" {
                            vibemon_restored = restored;
                        }
                    }
                    Err(error) => log::error!("Could not restore overlay {label}: {error}"),
                }
            }
            crate::chat_window::update_input_candidates();
        }) {
            log::error!("Could not schedule overlay restoration: {error}");
        }
    }

    fn restore_window(window: &WebviewWindow) -> Result<bool, String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: main thread holds the live window.
        let native = unsafe { &*(pointer as *const NSWindow) };
        if !crate::panel::should_restore(window.label(), native.isVisible()) || !native.isKindOfClass(NSPanel::class())
        {
            return Ok(false);
        }
        crate::panel::restore(window)?;
        match window.label() {
            "vibemon" => crate::vibemon::window::repair_position(native)?,
            "bubble-menu-vibemon" => {
                let parent = window.app_handle().get_webview_window("vibemon").ok_or("Bubble parent unavailable")?;
                let pointer = parent.ns_window().map_err(|error| error.to_string())?;
                // SAFETY: parent remains alive on the main thread throughout layout.
                let parent = unsafe { &*(pointer as *const NSWindow) };
                crate::vibemon::window::repair_bubble_position(native, parent)?;
            }
            _ => {}
        }
        native.orderFrontRegardless();
        Ok(true)
    }
}
