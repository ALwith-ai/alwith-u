//! Application policy around the shared Drive service.
use alwith_drive::contract::{DriveEvent, DriveRequest, Payload};
use alwith_drive::service::{DriveService, ServiceOptions};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[path = "drive_paths.rs"]
mod paths;

pub struct DriveState {
    service: Result<Arc<DriveService>, String>,
    closing: AtomicBool,
    stopped: AtomicBool,
    diagnostic_state: Mutex<Option<Value>>,
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let opener = app.clone();
    let service = DriveService::new(ServiceOptions {
        data_directory: app.path().app_data_dir()?.join("drive"),
        ownership_directory: home.join(".alwith-drive").join("owners"),
        default_root: home.join("YUP Drive"),
        reserved_roots: vec![],
        device_name: "ALwith U".into(),
        client_version: env!("CARGO_PKG_VERSION").into(),
        open_url: Arc::new(move |url| opener.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())),
    })
    .map(DriveService::with_existing_default_root)
    .and_then(|service| {
        let codex_home = std::env::var_os("CODEX_HOME").map_or_else(|| home.join(".codex"), std::path::PathBuf::from);
        tauri::async_runtime::block_on(service.set_skills_directory(codex_home.join("skills")))?;
        Ok(Arc::new(service))
    });
    match &service {
        Ok(service) => log::info!("[drive-initialize] {}", diagnostic_snapshot(&service.snapshot())),
        Err(error) => log::error!("[drive-initialize] failed error={error}"),
    }
    app.manage(DriveState {
        service: service.clone(),
        closing: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
        diagnostic_state: Mutex::new(None),
    });
    if let Ok(service) = service {
        let app = app.clone();
        let mut events = service.subscribe();
        tauri::async_runtime::spawn(async move {
            let mut last_status = None;
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
                match &event.payload {
                    Payload::Snapshot(snapshot) => log::info!("[drive-state] {}", diagnostic_snapshot(snapshot)),
                    Payload::Error(error) => log::error!(
                        "[drive-event] generation={} sequence={} error={error}",
                        event.generation,
                        event.sequence
                    ),
                    Payload::Status(status) => {
                        let summary = diagnostic_status(status).to_string();
                        if last_status.as_ref() != Some(&summary) {
                            log::info!(
                                "[drive-status] generation={} sequence={} status={summary}",
                                event.generation,
                                event.sequence
                            );
                            last_status = Some(summary);
                        }
                    }
                    Payload::Project(project) if project.failed > 0 || project.message.is_some() => log::warn!(
                        "[drive-project] {}",
                        json!({"generation": event.generation, "sequence": event.sequence, "project": project})
                    ),
                    _ => {}
                }
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
    fn record_snapshot(&self, snapshot: &alwith_drive::contract::Snapshot) {
        let key = json!({
            "configured": snapshot.configured, "running": snapshot.running,
            "generation": snapshot.generation, "roots": snapshot.roots.len(),
            "selectedRoots": snapshot.roots.iter().filter(|root| root.selected).count(),
            "error": snapshot.error,
        });
        let mut previous = self.diagnostic_state.lock().expect("Drive diagnostic state poisoned");
        if previous.as_ref() != Some(&key) {
            log::info!("[drive-state] {}", diagnostic_snapshot(snapshot));
            *previous = Some(key);
        }
    }

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
    // Never log request bodies: login and collaboration requests contain credentials.
    let operation = request.get("type").and_then(Value::as_str).unwrap_or("invalid").to_owned();
    let request: DriveRequest = serde_json::from_value(request).map_err(|error| error.to_string())?;
    if window.label() != "main"
        && matches!(&request, DriveRequest::McpSessionConfig | DriveRequest::CollabSession { .. })
    {
        return Err("Drive session credentials are available only to the main window".into());
    }
    let service = state.service()?;
    let started = std::time::Instant::now();
    let trace = !matches!(operation.as_str(), "snapshot" | "configuration" | "commentContext" | "comments");
    if trace {
        log::info!("[drive-request] operation={operation} phase=started window={}", window.label());
    }
    let response = match service.execute(request).await {
        Ok(response) => response,
        Err(error) => {
            log::error!(
                "[drive-request] operation={operation} phase=failed elapsedMs={} error={error} state={}",
                started.elapsed().as_millis(),
                diagnostic_snapshot(&service.snapshot())
            );
            return Err(error);
        }
    };
    if let alwith_drive::contract::DriveResponse::Snapshot(snapshot) = &response {
        state.record_snapshot(snapshot);
    }
    if trace {
        log::info!(
            "[drive-request] operation={operation} phase=completed elapsedMs={} state={}",
            started.elapsed().as_millis(),
            diagnostic_snapshot(&service.snapshot())
        );
    }
    serde_json::to_value(response).map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub async fn drive_path_exists(
    window: tauri::WebviewWindow, state: tauri::State<'_, DriveState>, path: std::path::PathBuf,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Drive filesystem access is limited to the main window".into());
    }
    let snapshot = state.service()?.snapshot();
    let roots = snapshot
        .roots
        .iter()
        .filter(|root| !root.drive_path.is_empty())
        .map(|root| std::path::PathBuf::from(&root.local_path))
        .collect::<Vec<_>>();
    paths::exists(std::path::Path::new(&snapshot.local_root), &roots, &path)
}

/// Bounded operational evidence without credentials or file contents.
pub(crate) fn diagnostic_snapshot(snapshot: &alwith_drive::contract::Snapshot) -> Value {
    json!({
        "configured": snapshot.configured,
        "running": snapshot.running,
        "generation": snapshot.generation,
        "sequence": snapshot.sequence,
        "localRoot": snapshot.local_root,
        "roots": snapshot.roots.len(),
        "selectedRoots": snapshot.roots.iter().filter(|root| root.selected).count(),
        "files": snapshot.files.len(),
        "projects": snapshot.projects.len(),
        "pendingDeletes": snapshot.pending_deletes.len(),
        "error": snapshot.error,
        "status": snapshot.status.as_ref().map(diagnostic_status),
        "failedProjects": snapshot.projects.iter().filter(|project| project.failed > 0 || project.message.is_some()).take(10).collect::<Vec<_>>(),
    })
}

fn diagnostic_status(status: &alwith_drive::sync::StatusSnapshot) -> Value {
    json!({
            "state": status.state,
            "pending": status.pending,
            "uploading": status.uploading,
            "downloading": status.downloading,
            "synced": status.synced,
            "failed": status.failed,
            "pushConnected": status.push_connected,
            "lastSyncAt": status.last_sync_at,
            "errorCount": status.errors.len(),
            "errors": status.errors.iter().rev().take(10).collect::<Vec<_>>(),
    })
}

pub fn prevent_exit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    let state = app.state::<DriveState>();
    if state.stopped.load(Ordering::Acquire) {
        return false;
    }
    if !state.closing.swap(true, Ordering::AcqRel) {
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
