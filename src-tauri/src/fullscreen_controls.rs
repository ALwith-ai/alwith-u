//! Connect native titlebar controls to Tauri window and command lifecycles.

mod native;

use native::{MAIN_WINDOW, TRAFFIC_LIGHT_CENTER_Y, align_native, prepare, traffic_light_center_y, window_key};
use objc2_app_kit::{NSWindow, NSWindowButton};
use std::sync::atomic::Ordering;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

fn align_main_window<R: Runtime>(window: &tauri::Window<R>) {
    if window.label() != "main" {
        return;
    }
    let handle = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
            // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
            align_native(unsafe { &*(pointer as *const NSWindow) }, traffic_light_center_y())
        });
        if let Err(error) = result {
            log::error!("Cannot align native window controls: {error}");
        }
    }) {
        log::error!("Cannot schedule traffic-light alignment: {error}");
    }
}

pub fn init() -> TauriPlugin<tauri::DynRuntime> {
    Builder::new("fullscreen-controls")
        .on_window_ready(|window| {
            let handle = window.clone();
            if let Err(error) = window.run_on_main_thread(move || match handle.ns_window() {
                Ok(pointer) => {
                    // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
                    let native = unsafe { &*(pointer as *const NSWindow) };
                    prepare(native);
                    if handle.label() == "main" {
                        MAIN_WINDOW.with(|main| main.set(Some(window_key(native))));
                        if let Err(error) = align_native(native, traffic_light_center_y()) {
                            log::error!("Cannot align native window controls: {error}");
                        }
                    }
                }
                Err(error) => log::error!("Cannot prepare fullscreen controls: {error}"),
            }) {
                log::error!("Cannot schedule fullscreen controls: {error}");
            }
        })
        .build()
}

/// Keep native controls centered in the zoomed webview toolbar.
#[tauri::command]
pub async fn set_traffic_light_zoom(window: tauri::WebviewWindow, zoom: f64) -> Result<(), String> {
    if !zoom.is_finite() || zoom <= 0.0 {
        return Err("Window zoom must be a positive finite number".into());
    }
    if window.label() != "main" {
        return Ok(());
    }
    let center_y = 16.0 * zoom;
    TRAFFIC_LIGHT_CENTER_Y.store(center_y.to_bits(), Ordering::Relaxed);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
                // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
                let native = unsafe { &*(pointer as *const NSWindow) };
                align_native(native, center_y)?;
                let close =
                    native.standardWindowButton(NSWindowButton::CloseButton).expect("Aligned native close button");
                let rect = close.convertRect_toView(close.bounds(), None);
                let content = native.contentView().expect("Aligned content view");
                let content_rect = content.convertRect_toView(content.bounds(), None);
                let top = content_rect.origin.y + content_rect.size.height;
                log::debug!(
                    "Traffic-light zoom {zoom}: target center {center_y}, native center {}",
                    top - rect.origin.y - rect.size.height / 2.0
                );
                Ok(())
            });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

/// Re-align after the packaged app restores its native window geometry or display scale.
pub(crate) fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
            | tauri::WindowEvent::Focused(true)
            | tauri::WindowEvent::Moved(_)
    ) {
        return;
    }
    align_main_window(window);
}
