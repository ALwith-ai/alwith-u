//! Application policy around the shared Drive plugin: U's directories and names, its read-only
//! existence check and its place in the ordered exit.
use std::sync::Arc;
use tauri::Manager;
use alwith_drive::{Config, Drive, DriveService, NativeError, ServiceOptions};
use tauri_plugin_opener::OpenerExt;

#[path = "drive_paths.rs"]
mod paths;

fn failed(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("failed", error)
}

/// Start Drive from U's directories; `drive:event` reaches the main and settings windows.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    alwith_drive::init(
        Config::new(|app| {
            let home = app.path().home_dir().map_err(failed)?;
            let opener = app.clone();
            let service = DriveService::new(ServiceOptions {
                data_directory: app.path().app_data_dir().map_err(failed)?.join("drive"),
                ownership_directory: home.join(".alwith-drive").join("owners"),
                default_root: home.join("YUP Drive"),
                reserved_roots: vec![],
                device_name: "ALwith U".into(),
                client_version: env!("CARGO_PKG_VERSION").into(),
                open_url: Arc::new(move |url| opener.opener().open_url(url, None::<&str>).map_err(failed)),
            })?
            .with_existing_default_root()?;
            let codex_home =
                std::env::var_os("CODEX_HOME").map_or_else(|| home.join(".codex"), std::path::PathBuf::from);
            tauri::async_runtime::block_on(service.set_skills_directory(codex_home.join("skills")))?;
            Ok(service)
        })
        .event_windows(["main", "settings"])
        .development_directory(crate::native::development_directory()),
    )
}

#[tauri3_specta::command]
pub async fn drive_path_exists(
    window: tauri::WebviewWindow, state: tauri::State<'_, Drive>, path: std::path::PathBuf,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Drive filesystem access is limited to the main window".into());
    }
    let snapshot = state.service().map_err(|error| error.message)?.snapshot().map_err(|error| error.message)?;
    let roots = snapshot
        .roots
        .iter()
        .filter(|root| !root.drive_path.is_empty())
        .map(|root| std::path::PathBuf::from(&root.local_path))
        .collect::<Vec<_>>();
    paths::exists(std::path::Path::new(&snapshot.local_root), &roots, &path)
}

/// Runs after the dirty-buffer confirmation: hide the windows, drain and stop Drive, then exit.
pub fn prevent_exit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    let drive = app.state::<Drive>();
    if drive.is_stopped() {
        return false;
    }
    if drive.begin_shutdown() {
        // On macOS, set_enabled(false) creates an animated sheet; hiding keeps cleanup invisible
        // without destroying the webviews needed to drain outstanding IPC replies.
        for window in app.webview_windows().into_values() {
            if let Err(error) = window.hide() {
                log::error!("Cannot hide window {} during shutdown: {error}", window.label());
            }
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let started = std::time::Instant::now();
            log::info!("Stopping Drive before application exit");
            if let Err(error) = app.state::<Drive>().shutdown().await {
                log::error!("Drive shutdown failed: {error}");
            }
            log::info!("Drive shutdown completed in {:?}", started.elapsed());
            app.exit(code.unwrap_or(0));
        });
    }
    true
}
