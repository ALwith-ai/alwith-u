//! Application-owned Runtime connection. The shared SDK owns framing, request correlation,
//! journal refill and process shutdown; each webview receives only its own request replies.
use alwith_api::{ClientEvent, ResponseError, RuntimeClient, process::HideConsoleExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri3_specta::Event;

const READY_TIMEOUT: Duration = Duration::from_secs(20);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct RuntimeState {
    connections: Mutex<HashMap<String, String>>,
    pub admission: tokio::sync::Mutex<()>,
    client: Mutex<Option<Arc<RuntimeClient>>>,
    starting: tokio::sync::Mutex<()>,
    closing: AtomicBool,
    close_signal: tokio::sync::Notify,
}

impl RuntimeState {
    pub fn current(&self) -> Result<Arc<RuntimeClient>, String> {
        if self.closing.load(Ordering::Acquire) {
            return Err("Application is closing".into());
        }
        let client = self.client.lock().unwrap().clone().ok_or("alwith-runtime is not running")?;
        if let Some(reason) = client.closed() {
            return Err(reason);
        }
        Ok(client)
    }

    fn owns(&self, client: &Arc<RuntimeClient>) -> bool {
        self.client.lock().unwrap().as_ref().is_some_and(|current| Arc::ptr_eq(current, client))
    }

    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::Release);
        self.close_signal.notify_waiters();
        tauri::async_runtime::block_on(async {
            let _starting = self.starting.lock().await;
            let client = self.client.lock().unwrap().take();
            if let Some(client) = client {
                client.close(SHUTDOWN_GRACE).await;
            }
        });
    }
}

fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = exe.parent().ok_or("executable has no parent directory")?;
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let path = directory.join(file);
    if !path.is_file() {
        return Err(format!("sidecar {name} missing at {}", path.display()));
    }
    Ok(path)
}

/// Read the same bundled executable used by the Runtime, not the ACP adapter's package version.
#[tauri3_specta::command]
pub async fn codex_version() -> Result<String, String> {
    let mut command = tokio::process::Command::new(sidecar_path("codex")?);
    command.arg("--version").kill_on_drop(true).hide_console();
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .map_err(|_| "Codex version check timed out")?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("Codex version check failed: {}", output.status));
    }
    let stdout = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    stdout
        .trim()
        .strip_prefix("codex-cli ")
        .filter(|version| !version.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Unexpected Codex version output".into())
}

fn engines_table(app: &AppHandle) -> Result<String, String> {
    #[cfg(debug_assertions)]
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    #[cfg(not(debug_assertions))]
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let _ = app;
    let adapter = resources.join("adapter/codex-acp-v2.mjs");
    if !adapter.is_file() {
        return Err(format!("ACP adapter missing at {}", adapter.display()));
    }
    let catalogs = std::env::join_paths(crate::providers::bundled_model_catalogs(&resources)?)
        .map_err(|error| error.to_string())?;
    let mut engines = json!({"codex": {
        "command": sidecar_path("bun")?,
        "args": ["--no-install", adapter],
        "env": {"CODEX_PATH": sidecar_path("codex")?, "CODEX_ACP_MODEL_CATALOGS": catalogs.to_string_lossy()}
    }});
    // Development seam: `ALWITH_U_DSH_AGENT` names a dsh-agent entry (`.../dsh-agent/src/main.ts`) run with
    // bundled Bun (`ALWITH_U_BUN` explicitly overrides it). Never discover Desktop's Bun through PATH.
    if let Ok(entry) = std::env::var("ALWITH_U_DSH_AGENT") {
        if !PathBuf::from(&entry).is_file() {
            return Err(format!("ALWITH_U_DSH_AGENT is not a file: {entry}"));
        }
        let bun = match std::env::var_os("ALWITH_U_BUN") {
            Some(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() || !path.is_file() {
                    return Err("ALWITH_U_BUN must be an absolute path to a file".into());
                }
                path
            }
            None => sidecar_path("bun")?,
        };
        engines["dsh"] = json!({"command": bun, "args": [entry]});
    }
    Ok(engines.to_string())
}

/// Where the Runtime finds modules (`alwith-module.json` packages): `ALWITH_MODULES_DIR` when set, else this
/// checkout's `node_modules` in development builds. Release builds without the variable load no modules.
fn modules_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("ALWITH_MODULES_DIR") {
        return Some(PathBuf::from(dir));
    }
    if cfg!(debug_assertions) {
        return Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../node_modules"));
    }
    None
}

#[tauri3_specta::command]
pub async fn runtime_start(
    app: AppHandle, window: WebviewWindow, state: State<'_, RuntimeState>, connection_id: String,
) -> Result<(), String> {
    if connection_id.is_empty() {
        return Err("Missing connection identity".into());
    }
    state.connections.lock().unwrap().insert(window.label().into(), connection_id);
    let _starting = state.starting.lock().await;
    let closing = state.close_signal.notified();
    tokio::pin!(closing);
    closing.as_mut().enable();
    if state.closing.load(Ordering::Acquire) {
        return Err("Application is closing".into());
    }
    if state.current().is_ok() {
        return Ok(());
    }
    let stale = state.client.lock().unwrap().take();
    if let Some(stale) = stale {
        stale.close(SHUTDOWN_GRACE).await;
    }
    let journal = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("runtime/sessions");
    let mut command = tokio::process::Command::new(sidecar_path("alwith-runtime")?);
    command
        .args(["--listen", "stdio://"])
        .env("ALWITH_RUNTIME_ENGINES", engines_table(&app)?)
        .env("ALWITH_RUNTIME_JOURNAL", journal)
        .env("ALWITH_RUNTIME_PARENT_PID", std::process::id().to_string())
        .env("RUST_LOG", "info")
        .hide_console();
    if let Some(dir) = modules_dir() {
        command.env("ALWITH_MODULES_DIR", dir);
    }
    let client = tokio::select! {
        result = tokio::time::timeout(READY_TIMEOUT, RuntimeClient::spawn(command)) => {
            Arc::new(result.map_err(|_| "alwith-runtime did not report ready in time")?.map_err(|error| error.to_string())?)
        }
        _ = closing => return Err("Application closed during Runtime startup".into())
    };
    let mut events = client.events();
    *state.client.lock().unwrap() = Some(Arc::clone(&client));
    app.state::<crate::providers::Providers>().reset().await;
    let identity = Arc::downgrade(&client);
    tauri::async_runtime::spawn(async move {
        // Every emit is one script evaluation on the app's main thread. A session replay
        // arrives as thousands of frames within milliseconds; forwarding them one event
        // each stalls the whole app, so a burst is drained here and delivered as one
        // `LINES_EVENT` payload, in order, which the webview folds in a single task.
        'events: while let Some(first) = events.recv().await {
            let mut burst = vec![first];
            while let Ok(event) = events.try_recv() {
                burst.push(event);
            }
            let Some(client) = identity.upgrade() else {
                break;
            };
            let state = app.state::<RuntimeState>();
            if !state.owns(&client) {
                break;
            }
            let mut lines = Vec::with_capacity(burst.len());
            for event in burst {
                match event {
                    ClientEvent::Closed { reason } => {
                        if !lines.is_empty() {
                            let _ = RuntimeLines(std::mem::take(&mut lines)).emit(&app);
                        }
                        log::info!("alwith-runtime exited: {reason}");
                        state.client.lock().unwrap().take();
                        let _ = RuntimeExit { code: None, signal: None }.emit(&app);
                        break 'events;
                    }
                    // Wire diagnostics belong to the native host. Private configuration frames
                    // never enter a webview, including when using an older distributed Runtime.
                    ClientEvent::Runtime(alwith_api::RuntimeEvent::Wire { .. }) => {}
                    ClientEvent::Runtime(alwith_api::RuntimeEvent::Outbound { ref line, .. })
                        if private_request(line) => {}
                    ClientEvent::Runtime(event) => {
                        let retry = matches!(&event, alwith_api::RuntimeEvent::RunStates { .. });
                        if matches!(&event, alwith_api::RuntimeEvent::Exit { .. }) {
                            app.state::<crate::providers::Providers>().reset().await;
                        }
                        if retry {
                            crate::providers::schedule_apply(&app);
                        }
                        let value = serde_json::to_value(event).expect("serialize Runtime event");
                        lines.push(value.to_string());
                    }
                    // The webview SDK performs its own sequence check and reports unrecoverable
                    // gaps to its consumers. Prompt it to reconcile its journal cursor now.
                    ClientEvent::Gap { .. } => lines.push(json!({"type":"lagged"}).to_string()),
                    ClientEvent::Other(value) => lines.push(value.to_string()),
                }
            }
            if !lines.is_empty() {
                let _ = RuntimeLines(lines).emit(&app);
            }
        }
    });
    Ok(())
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    params: Option<Value>,
}

#[tauri3_specta::command]
pub async fn runtime_send(
    window: WebviewWindow, state: State<'_, RuntimeState>, line: String, connection_id: String,
) -> Result<(), String> {
    let request: Request = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    let current_connection = || state.connections.lock().unwrap().get(window.label()) == Some(&connection_id);
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    let client = state.current()?;
    let lifecycle = is_admission(&request);
    let _admission = if lifecycle { Some(state.admission.lock().await) } else { None };
    if lifecycle {
        crate::providers::apply_locked(window.app_handle(), &client).await?;
    }
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    let outcome = client.request(&request.method, request.params).await;
    if !state.owns(&client) {
        return Err("Runtime instance replaced".into());
    }
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    drop(_admission);
    if lifecycle {
        crate::providers::schedule_apply(window.app_handle());
    }
    let response = match outcome {
        Ok(result) => json!({"connectionId":connection_id,"id":request.id,"result":result,"error":null}),
        Err(error) => json!({"connectionId":connection_id,"id":request.id,"error":error}),
    };
    RuntimeLines(vec![response.to_string()]).emit(&window).map_err(|error| error.to_string())
}

pub fn request_error(error: ResponseError) -> String {
    format!("Runtime request failed ({}): {}", error.code, error.message)
}

fn is_admission(request: &Request) -> bool {
    matches!(request.method.as_str(), "sessionNew" | "sessionResume" | "sessionLoad" | "sessionFork" | "prompt")
        || (request.method == "acpRequest"
            && matches!(
                request.params.as_ref().and_then(|p| p.get("method")).and_then(Value::as_str),
                Some("session/new" | "session/resume" | "session/load" | "session/fork" | "session/prompt")
            ))
}

fn private_request(line: &str) -> bool {
    serde_json::from_str::<Value>(line).ok().is_some_and(|frame| {
        matches!(frame.get("method").and_then(Value::as_str), Some("providers/set" | "auth/login"))
    })
}

#[derive(Clone, serde::Serialize, specta::Type, tauri3_specta::Event)]
#[serde(transparent)]
#[event(name = "runtime:lines")]
pub struct RuntimeLines(pub Vec<String>);

#[derive(Clone, serde::Serialize, specta::Type, tauri3_specta::Event)]
#[event(name = "runtime:exit")]
pub struct RuntimeExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[cfg(test)]
mod binding_tests {
    use super::*;

    #[test]
    fn runtime_events_preserve_the_shared_sdk_wire_contract() {
        assert_eq!(RuntimeLines::NAME, "runtime:lines");
        assert_eq!(RuntimeExit::NAME, "runtime:exit");
        assert_eq!(serde_json::to_value(RuntimeLines(vec!["frame".into()])).unwrap(), json!(["frame"]));
        assert_eq!(
            serde_json::to_value(RuntimeExit { code: None, signal: None }).unwrap(),
            json!({"code": null, "signal": null})
        );
    }
}
