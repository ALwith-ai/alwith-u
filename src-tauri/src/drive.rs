//! Application policy around the shared Drive service.
use alwith_drive::contract::{DriveEvent, DriveRequest, Payload};
use alwith_drive::service::{DriveService, ServiceOptions};
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

pub struct DriveState {
    service: Result<Arc<DriveService>, String>,
    closing: AtomicBool,
    stopped: AtomicBool,
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let opener = app.clone();
    let service = DriveService::new(ServiceOptions {
        data_directory: app.path().app_data_dir()?.join("drive"),
        ownership_directory: home.join(".alwith-drive").join("owners"),
        default_root: home.join("YUP Drive U"),
        reserved_roots: vec![home.join("YUP Drive")],
        device_name: "ALwith U".into(),
        client_version: env!("CARGO_PKG_VERSION").into(),
        open_url: Arc::new(move |url| opener.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())),
    })
    .and_then(|service| {
        let codex_home =
            std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".codex"));
        tauri::async_runtime::block_on(service.set_skills_directory(codex_home.join("skills")))?;
        Ok(Arc::new(service))
    });
    app.manage(DriveState {
        service: service.clone(),
        closing: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
    });
    if let Ok(service) = service {
        let app = app.clone();
        let mut events = service.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let snapshot = service.snapshot();
                        DriveEvent {
                            version: snapshot.version,
                            generation: snapshot.generation,
                            sequence: snapshot.sequence,
                            payload: Payload::Snapshot(snapshot),
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                for label in ["main", "settings"] {
                    if let Err(error) = app.emit_to(label, "drive:event", &event) {
                        log::error!("Cannot forward Drive event to {label}: {error}");
                    }
                }
            }
        });
    }
    Ok(())
}

impl DriveState {
    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }

    pub fn service(&self) -> Result<&DriveService, String> {
        if self.closing.load(Ordering::Acquire) {
            return Err("Application is closing".into());
        }
        self.service.as_deref().map_err(Clone::clone)
    }
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
    let response = state.service()?.execute(request).await?;
    serde_json::to_value(response).map_err(|error| error.to_string())
}

pub fn prevent_exit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    let state = app.state::<DriveState>();
    if state.stopped.load(Ordering::Acquire) {
        return false;
    }
    if !state.closing.swap(true, Ordering::AcqRel) {
        // Dirty-buffer approval precedes this irreversible shutdown phase.
        for window in app.webview_windows().into_values() {
            if let Err(error) = window.set_enabled(false) {
                log::error!("Cannot disable a window during shutdown: {error}");
            }
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let started = std::time::Instant::now();
            log::info!("Stopping Drive before application exit");
            let state = app.state::<DriveState>();
            if let Ok(service) = &state.service
                && let Err(error) = service.shutdown().await
            {
                log::error!("Drive shutdown failed: {error}");
            }
            log::info!("Drive shutdown completed in {:?}", started.elapsed());
            state.stopped.store(true, Ordering::Release);
            app.exit(code.unwrap_or(0));
        });
    }
    true
}
