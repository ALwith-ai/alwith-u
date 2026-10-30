//! Application-owned Runtime connection. The shared SDK owns framing, request correlation,
//! journal refill and process shutdown; each webview receives only its own request replies.
use alwith_api::{ClientEvent, ResponseError, RuntimeClient, process::HideConsoleExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    initializations: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    closing: AtomicBool,
    shutdown_complete: AtomicBool,
    close_signal: tokio::sync::Notify,
}

impl RuntimeState {
    /// Webview reloads can overlap while the first ACP handshake is still in flight.
    /// Only serialize admission: Runtime retains the initialization result and owns the process.
    async fn initialize_guard(&self, request: &Request) -> Option<tokio::sync::OwnedMutexGuard<()>> {
        let agent_id = initialization_agent(request)?;
        let lock = self.initializations.lock().unwrap().entry(agent_id.into()).or_default().clone();
        Some(lock.lock_owned().await)
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }

    pub fn current(&self) -> Result<Arc<RuntimeClient>, String> {
        if self.is_closing() {
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

    fn begin_shutdown(&self) -> bool {
        if self.closing.swap(true, Ordering::AcqRel) {
            return false;
        }
        self.close_signal.notify_waiters();
        true
    }

    async fn shutdown(&self) {
        let _starting = self.starting.lock().await;
        let client = self.client.lock().unwrap().take();
        if let Some(client) = client {
            client.close(SHUTDOWN_GRACE).await;
        }
        self.shutdown_complete.store(true, Ordering::Release);
        log::info!("Runtime shutdown complete");
    }

    /// Last-resort cleanup for a native termination that bypasses ExitRequested.
    pub fn kill_on_exit(&self) {
        if let Some(client) = self.client.lock().unwrap().take() {
            log::warn!("Native termination bypassed graceful Runtime shutdown");
            client.kill();
        }
    }
}

/// Keep the native event loop alive while IPC replies and Runtime shutdown drain.
/// Blocking this thread can strand a Tokio worker waiting for a WebKit response.
pub fn prevent_exit(app: &AppHandle, code: Option<i32>) -> bool {
    let state = app.state::<RuntimeState>();
    if state.shutdown_complete.load(Ordering::Acquire) {
        return false;
    }
    if state.begin_shutdown() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = app.state::<alwith_computer::ComputerHost>().shutdown().await {
                log::error!("Computer shutdown failed: {error}");
            }
            if let Err(error) = crate::mobile::shutdown().await {
                log::error!("Mobile shutdown failed: {error}");
            }
            app.state::<RuntimeState>().shutdown().await;
            app.exit(code.unwrap_or(0));
        });
    }
    true
}

pub(crate) fn sidecar_path(name: &str) -> Result<PathBuf, String> {
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
    let adapter = resources.join("adapter/codex-bootstrap.mjs");
    if !adapter.is_file() {
        return Err(format!("ACP adapter missing at {}", adapter.display()));
    }
    let catalogs = std::env::join_paths(crate::providers::bundled_model_catalogs(&resources)?)
        .map_err(|error| error.to_string())?;
    let mut engines = json!({"codex": {
        "command": sidecar_path("bun")?,
        "args": ["--no-install", adapter],
        "env": {"CODEX_PATH": sidecar_path("alwith-codex-launcher")?, "ALWITH_U_CODEX_PATH": sidecar_path("codex")?, "CODEX_ACP_MODEL_CATALOGS": catalogs.to_string_lossy()}
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
        crate::power::sync(&app, false);
    }
    let cache = app.path().app_cache_dir().map_err(|error| error.to_string())?;
    let data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let mut command = tokio::process::Command::new(sidecar_path("alwith-runtime")?);
    configure_runtime_storage(&mut command, &cache, &data);
    command
        .args(["--listen", "stdio://"])
        .env("ALWITH_RUNTIME_ENGINES", engines_table(&app)?)
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
                        crate::diagnostics::runtime_closed(&reason);
                        crate::power::sync(&app, false);
                        if let Err(error) = app.state::<alwith_computer::ComputerHost>().stop_current().await {
                            log::error!("Computer cleanup after Runtime exit failed: {error}");
                        }
                        app.state::<crate::computer::ComputerGateway>().gateway.stop_all();
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
                        crate::diagnostics::runtime_event(&event);
                        crate::providers::managed::observe_event(&app, &event);
                        crate::mobile::publish(&event);
                        if matches!(&event, alwith_api::RuntimeEvent::Exit { agent_id } if agent_id == "codex")
                            && let Err(error) = app.state::<alwith_computer::ComputerHost>().stop_current().await
                        {
                            log::error!("Computer cleanup after Codex exit failed: {error}");
                        }
                        if let alwith_api::RuntimeEvent::RunStates { sessions } = &event {
                            crate::power::sync(
                                &app,
                                crate::power::has_active_tasks(sessions.iter().map(|session| &session.state)),
                            );
                            app.state::<crate::computer::ComputerGateway>().gateway.sync_running(
                                sessions
                                    .iter()
                                    .filter(|s| {
                                        matches!(
                                            s.state,
                                            alwith_api::RunState::Running | alwith_api::RunState::RequiresAction
                                        )
                                    })
                                    .map(|s| s.session_id.clone())
                                    .collect(),
                            );
                        }
                        if matches!(&event, alwith_api::RuntimeEvent::Exit {agent_id} if agent_id=="codex") {
                            app.state::<crate::computer::ComputerGateway>().gateway.stop_all();
                        }
                        let retry = matches!(&event, alwith_api::RuntimeEvent::RunStates { .. });
                        if resets_provider_catalog(&event) {
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
                    ClientEvent::Gap { .. } => {
                        match client.run_states().await {
                            Ok(states) => crate::power::sync(
                                &app,
                                crate::power::has_active_tasks(states.iter().map(|session| &session.state)),
                            ),
                            Err(error) => log::error!("Cannot reconcile sleep inhibition after Runtime gap: {error}"),
                        }
                        lines.push(json!({"type":"lagged"}).to_string());
                    }
                    ClientEvent::Other(value) => lines.push(value.to_string()),
                }
            }
            if !lines.is_empty() {
                let _ = RuntimeLines(lines).emit(&app);
            }
        }
        if let Some(client) = identity.upgrade()
            && app.state::<RuntimeState>().owns(&client)
        {
            crate::power::sync(&app, false);
        }
    });
    Ok(())
}

/// Independent host processes must not overwrite each other's attention snapshots or process leases.
fn configure_runtime_storage(command: &mut tokio::process::Command, cache: &Path, data: &Path) {
    command
        .env("ALWITH_RUNTIME_JOURNAL", cache.join("runtime/sessions"))
        .env("ALWITH_RUNTIME_ATTENTION", data.join("runtime/attention"));
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
    let mut diagnostic = crate::diagnostics::RequestTrace::begin(
        &request.method,
        request.params.as_ref(),
        &format!("{connection_id}:{}", request.id),
    );
    let current_connection = || state.connections.lock().unwrap().get(window.label()) == Some(&connection_id);
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    let _initialization = state.initialize_guard(&request).await;
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    let client = state.current()?;
    let lifecycle = is_admission(&request)
        || crate::providers::managed::requires_admission(&request.method, request.params.as_ref())
        || matches!(request.method.as_str(), "sessionNew")
        || (request.method == "acpRequest"
            && matches!(
                request.params.as_ref().and_then(|p| p["method"].as_str()),
                Some("session/new" | "session/set_config_option")
            ));
    let _admission = if lifecycle { Some(state.admission.lock().await) } else { None };
    let temporary_gamepad = match gamepad_admission_target(window.label(), &request) {
        Some(agent_id) => {
            client.agents().await.map_err(request_error)?.iter().any(|agent| agent["agentId"] == agent_id)
        }
        None => false,
    };
    let active_prompt = if let Some(session_id) = prompt_session_id(&request) {
        let states = client.run_states().await.map_err(request_error)?;
        is_active_prompt_target(session_id, states.iter().map(|session| (session.session_id.as_str(), &session.state)))
    } else {
        false
    };
    // Busy providers retain their applied routing; unrelated sessions can continue.
    if requires_provider_application(&request)
        && !temporary_gamepad
        && !active_prompt
        && let Err(error) = crate::providers::apply_locked(window.app_handle(), &client).await
        && !crate::providers::application_pending(&error)
    {
        return Err(error);
    }
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    let generation = crate::providers::managed::check(window.app_handle(), &request.method, request.params.as_ref())?;
    let original = request.params.clone();
    let outcome = client.request(&request.method, request.params).await;
    diagnostic.finish(&outcome);
    if let (Some(params), Ok(value)) = (&original, &outcome) {
        crate::providers::managed::observe_realtime(window.app_handle(), &request.method, params);
        let body = if request.method == "acpRequest" { &params["params"] } else { params };
        if let Some(session) = value["sessionId"].as_str().or_else(|| body["sessionId"].as_str()) {
            let agent = params["agentId"].as_str().unwrap_or("codex");
            let confirmed = crate::providers::managed::confirms_model(&request.method, params).then_some(generation);
            crate::providers::managed::observe(window.app_handle(), agent, session, value, confirmed);
        }
    }
    if !state.owns(&client) {
        return Err("Runtime instance replaced".into());
    }
    if !current_connection() {
        return Err("Window connection replaced".into());
    }
    drop(_admission);
    if lifecycle && !temporary_gamepad {
        crate::providers::schedule_apply(window.app_handle());
    }
    let response = match outcome {
        Ok(result) => json!({"connectionId":connection_id,"id":request.id,"result":result,"error":null}),
        Err(error) => json!({"connectionId":connection_id,"id":request.id,"error":error}),
    };
    RuntimeLines(vec![response.to_string()]).emit(&window).map_err(|error| error.to_string())
}

/// Auxiliary agents own separate catalogs and cannot invalidate the main Codex catalog.
fn resets_provider_catalog(event: &alwith_api::RuntimeEvent) -> bool {
    matches!(event, alwith_api::RuntimeEvent::Exit { agent_id } if agent_id == "codex")
}

pub fn request_error(error: ResponseError) -> String {
    let details = error.data.filter(|data| !data.is_null()).map(|data| format!("; data: {data}")).unwrap_or_default();
    format!("Runtime request failed ({}): {}{details}", error.code, error.message)
}

fn initialization_agent(request: &Request) -> Option<&str> {
    let params = request.params.as_ref()?;
    match request.method.as_str() {
        "initialize" => params.get("agentId")?.as_str(),
        "acpRequest" if params.get("method")?.as_str()? == "initialize" => params.get("agentId")?.as_str(),
        _ => None,
    }
}

fn is_admission(request: &Request) -> bool {
    match request.method.as_str() {
        "sessionNew" => !is_draft_session_new(request.params.as_ref()),
        "sessionResume" | "sessionLoad" | "sessionFork" | "prompt" => true,
        "acpRequest" => match request.params.as_ref().and_then(|p| p.get("method")).and_then(Value::as_str) {
            Some("session/new") => !is_draft_session_new(request.params.as_ref().and_then(|p| p.get("params"))),
            Some("session/resume" | "session/load" | "session/fork" | "session/prompt") => true,
            _ => false,
        },
        _ => false,
    }
}

fn is_active_prompt_target<'a>(
    session_id: &str, states: impl IntoIterator<Item = (&'a str, &'a alwith_api::RunState)>,
) -> bool {
    states.into_iter().any(|(id, state)| {
        id == session_id && matches!(state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction)
    })
}

/// Replies and steering use the active turn's catalog, even when a new revision is pending.
fn prompt_session_id(request: &Request) -> Option<&str> {
    let params = request.params.as_ref()?;
    let prompt = match request.method.as_str() {
        "prompt" => params,
        "acpRequest" if params.get("method")?.as_str()? == "session/prompt" => params.get("params")?,
        _ => return None,
    };
    prompt.get("sessionId")?.as_str()
}

/// Restoring history keeps the applied catalog and still serializes with provider updates.
/// A pending revision must not prevent the user from opening an existing conversation.
fn requires_provider_application(request: &Request) -> bool {
    let restoring = match request.method.as_str() {
        "sessionResume" | "sessionLoad" => true,
        "acpRequest" => matches!(
            request.params.as_ref().and_then(|params| params.get("method")).and_then(Value::as_str),
            Some("session/resume" | "session/load")
        ),
        _ => false,
    };
    is_admission(request) && !restoring
}

/// Empty draft sessions may be created on the currently applied provider. The first prompt
/// retries saved changes while busy providers retain their previously applied routing.
fn is_draft_session_new(params: Option<&Value>) -> bool {
    let Some(params) = params else { return false };
    let meta = params.get("_meta").or_else(|| params.get("meta"));
    meta.and_then(|value| value.get("alwith").or_else(|| value.get("_meta").and_then(|nested| nested.get("alwith"))))
        .and_then(|value| value.get("draft"))
        .and_then(Value::as_bool)
        == Some(true)
}

/// The dedicated Gamepad agent receives its own catalog from gamepad_ai_prepare.
/// Keep admission serialization, without applying pending settings to the main agent.
fn gamepad_admission_target<'a>(window_label: &str, request: &'a Request) -> Option<&'a str> {
    if window_label != "gamepad" || request.method != "acpRequest" {
        return None;
    }
    let params = request.params.as_ref()?;
    if !matches!(params.get("method").and_then(Value::as_str), Some("session/new" | "session/prompt")) {
        return None;
    }
    let id = params.get("agentId")?.as_str()?;
    let suffix = id.strip_prefix("gamepad-config-")?;
    if suffix.len() != 36
        || !suffix.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) { byte == b'-' } else { byte.is_ascii_hexdigit() }
        })
    {
        return None;
    }
    Some(id)
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
#[path = "__tests__/runtime.rs"]
mod tests;

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

/// Inspect the exact bundled CLI selected by Runtime without starting a session.
#[tauri3_specta::command]
pub async fn codex_status() -> Result<serde_json::Value, String> {
    let status = tauri_plugin_alwith_desktop_shell::bundled_cli_status("codex").await?;
    serde_json::to_value(status).map_err(|error| error.to_string())
}
