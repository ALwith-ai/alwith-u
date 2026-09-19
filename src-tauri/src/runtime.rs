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
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const LINES_EVENT: &str = "runtime:lines";
pub const EXIT_EVENT: &str = "runtime:exit";
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

fn engines_table() -> Result<String, String> {
    let mut engines = json!({"codex": {"command": sidecar_path("codex-acp-v2")?, "env": {"CODEX_PATH": sidecar_path("codex")?}}});
    // Development seam: `ALWITH_U_DSH_AGENT` names a dsh-agent entry (`.../dsh-agent/src/main.ts`) run with
    // `bun` (`ALWITH_U_BUN` overrides the executable). U does not ship dsh yet; the story demo needs it.
    if let Ok(entry) = std::env::var("ALWITH_U_DSH_AGENT") {
        if !PathBuf::from(&entry).is_file() {
            return Err(format!("ALWITH_U_DSH_AGENT is not a file: {entry}"));
        }
        let bun = match std::env::var("ALWITH_U_BUN") {
            Ok(path) => PathBuf::from(path),
            Err(_) => find_on_path("bun").ok_or("bun not found on PATH; set ALWITH_U_BUN")?,
        };
        engines["dsh"] = json!({"command": bun, "args": [entry]});
    }
    Ok(engines.to_string())
}

/// The Runtime launches engines by absolute path; resolve a bare executable name the way a shell would.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(&file)).find(|path| path.is_file())
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

#[tauri::command]
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
        .env("ALWITH_RUNTIME_ENGINES", engines_table()?)
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
        while let Some(event) = events.recv().await {
            let Some(client) = identity.upgrade() else {
                break;
            };
            let state = app.state::<RuntimeState>();
            if !state.owns(&client) {
                break;
            }
            match event {
                ClientEvent::Closed { reason } => {
                    log::info!("alwith-runtime exited: {reason}");
                    state.client.lock().unwrap().take();
                    let _ = app.emit(EXIT_EVENT, json!({"code":null,"signal":null}));
                    break;
                }
                // Wire diagnostics belong to the native host. Private configuration frames
                // never enter a webview, including when using an older distributed Runtime.
                ClientEvent::Runtime(alwith_api::RuntimeEvent::Wire { .. }) => {}
                ClientEvent::Runtime(alwith_api::RuntimeEvent::Outbound { ref line, .. }) if private_request(line) => {}
                ClientEvent::Runtime(event) => {
                    let retry = matches!(&event, alwith_api::RuntimeEvent::RunStates { .. });
                    if matches!(&event, alwith_api::RuntimeEvent::Exit { .. }) {
                        app.state::<crate::providers::Providers>().reset().await;
                    }
                    if retry {
                        crate::providers::schedule_apply(&app);
                    }
                    let value = serde_json::to_value(event).expect("serialize Runtime event");
                    let _ = app.emit(LINES_EVENT, vec![value.to_string()]);
                }
                // The webview SDK performs its own sequence check and reports unrecoverable
                // gaps to its consumers. Prompt it to reconcile its journal cursor now.
                ClientEvent::Gap { .. } => {
                    let _ = app.emit(LINES_EVENT, vec![json!({"type":"lagged"}).to_string()]);
                }
                ClientEvent::Other(value) => {
                    let _ = app.emit(LINES_EVENT, vec![value.to_string()]);
                }
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

#[tauri::command]
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
    window.emit(LINES_EVENT, vec![response.to_string()]).map_err(|error| error.to_string())
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
