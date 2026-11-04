//! Application policy around the shared Drive service.
use alwith_drive::{Config, DriveRequest, DriveService, NativeError, ServiceOptions};
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[path = "drive_paths.rs"]
mod paths;

pub type DriveState = alwith_drive::Drive;

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    alwith_drive::init(
        Config::new(|app| {
            let home = app.path().home_dir().map_err(|error| NativeError::new("failed", error))?;
            let opener = app.clone();
            let service = DriveService::new(ServiceOptions {
                data_directory: app
                    .path()
                    .app_data_dir()
                    .map_err(|error| NativeError::new("failed", error))?
                    .join("drive"),
                ownership_directory: home.join(".alwith-drive").join("owners"),
                default_root: home.join("YUP Drive"),
                reserved_roots: vec![],
                device_name: "ALwith U".into(),
                client_version: env!("CARGO_PKG_VERSION").into(),
                open_url: Arc::new(move |url| {
                    opener.opener().open_url(url, None::<&str>).map_err(|error| NativeError::new("failed", error))
                }),
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
pub async fn drive_request(
    window: tauri::WebviewWindow, state: tauri::State<'_, DriveState>, request: Value,
) -> Result<Value, String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Drive access is limited to the main and settings windows".into());
    }
    let request: DriveRequest = serde_json::from_value(request).map_err(|error| error.to_string())?;
    if window.label() != "main"
        && matches!(&request, DriveRequest::McpSessionConfig | DriveRequest::CollabSession { .. })
    {
        return Err("Drive session credentials are available only to the main window".into());
    }
    let response = state
        .service()
        .map_err(|error| error.to_string())?
        .execute(request)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_value(response).map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub async fn drive_path_exists(
    window: tauri::WebviewWindow, state: tauri::State<'_, DriveState>, path: std::path::PathBuf,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Drive filesystem access is limited to the main window".into());
    }
    let snapshot = state.service().map_err(|error| error.to_string())?.snapshot().map_err(|error| error.to_string())?;
    let roots = snapshot
        .roots
        .iter()
        .filter(|root| !root.drive_path.is_empty())
        .map(|root| std::path::PathBuf::from(&root.local_path))
        .collect::<Vec<_>>();
    paths::exists(std::path::Path::new(&snapshot.local_root), &roots, &path)
}

pub fn prevent_exit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    let state = app.state::<DriveState>();
    if state.is_stopped() {
        return false;
    }
    if state.begin_shutdown() {
        // Dirty-buffer approval precedes this irreversible shutdown phase. On macOS,
        // set_enabled(false) creates an animated sheet; hiding keeps cleanup invisible
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
            let state = app.state::<DriveState>();
            if let Err(error) = state.shutdown().await {
                log::error!("Drive shutdown failed: {error}");
            }
            log::info!("Drive shutdown completed in {:?}", started.elapsed());
            app.exit(code.unwrap_or(0));
        });
    }
    true
}
