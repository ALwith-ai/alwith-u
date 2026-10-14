//! Activate the third-party controls only for the main Windows webview.

use tauri_plugin_decoration::WebviewWindowExt;

pub async fn activate(window: tauri::WebviewWindow) {
    if let Err(error) = window.activate_decoration().await {
        log::error!("Activate main window decoration: {error}");
        if let Err(restore_error) = window.restore_decoration().await {
            log::error!("Restore main window decoration: {restore_error}");
        }
    }
    if let Err(error) = window.show() {
        log::error!("Show main window after decoration setup: {error}");
    }
}
