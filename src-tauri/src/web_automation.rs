//! Application-owned Playwright execution over a private, versioned stdio channel.
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex as AsyncMutex, oneshot},
};

use crate::browser_ai::BrowserAi;

type Reply = oneshot::Sender<Result<Value, String>>;

struct Worker {
    _child: Child,
    input: Arc<AsyncMutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, Reply>>>,
    alive: Arc<AtomicBool>,
}
impl Worker {
    fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        let script = app.path().resource_dir().map_err(|e| e.to_string())?.join("browser/worker.mjs");
        if !script.is_file() {
            return Err("Bundled web automation executor is missing".into());
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let bun = exe.parent().ok_or("Application executable has no directory")?.join(if cfg!(windows) {
            "bun.exe"
        } else {
            "bun"
        });
        let mut child = Command::new(bun)
            .arg("--no-install")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = Arc::new(AsyncMutex::new(child.stdin.take().ok_or("Executor stdin missing")?));
        let output = child.stdout.take().ok_or("Executor stdout missing")?;
        let pending = Arc::new(Mutex::new(HashMap::<String, Reply>::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let replies = pending.clone();
        let running = alive.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(value) = serde_json::from_str::<Value>(&line) else { break };
                let Some(id) = value["id"].as_str() else { break };
                if let Some(reply) = replies.lock().unwrap().remove(id) {
                    let result = match value.get("error") {
                        Some(error) => Err(error.as_str().unwrap_or("Invalid executor error").to_owned()),
                        None => value.get("result").cloned().ok_or("Executor result missing".into()),
                    };
                    let _ = reply.send(result);
                }
            }
            running.store(false, Ordering::Release);
            for (_, reply) in replies.lock().unwrap().drain() {
                let _ =
                    reply.send(Err("Web automation executor disconnected; inspect the page before retrying".into()));
            }
        });
        Ok(Self { _child: child, input, pending, alive })
    }
}

#[derive(Default)]
pub struct Executor {
    worker: AsyncMutex<Option<Worker>>,
    tokens: Mutex<HashMap<String, String>>,
    transport: std::sync::OnceLock<String>,
}
impl Executor {
    async fn request(&self, app: &tauri::AppHandle, mut message: Value) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (send, receive) = oneshot::channel();
        let (input, pending) = {
            let mut slot = self.worker.lock().await;
            if slot.as_ref().is_none_or(|worker| !worker.alive.load(Ordering::Acquire)) {
                *slot = Some(Worker::start(app)?);
            }
            let worker = slot.as_ref().unwrap();
            worker.pending.lock().unwrap().insert(id.clone(), send);
            (worker.input.clone(), worker.pending.clone())
        };
        message["version"] = json!(1);
        message["id"] = json!(id);
        let mut bytes = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        let result = async {
            input.lock().await.write_all(&bytes).await.map_err(|e| e.to_string())?;
            receive.await.map_err(|_| "Executor reply channel closed".to_owned())?
        };
        let result = tokio::time::timeout(Duration::from_secs(45), result)
            .await
            .map_err(|_| "Web automation timed out; inspect the page before retrying".to_owned())
            .and_then(|r| r);
        pending.lock().unwrap().remove(&id);
        result
    }

    fn token(&self, state: &BrowserAi, session_id: &str) -> String {
        let mut tokens = self.tokens.lock().unwrap();
        let token = tokens.entry(session_id.into()).or_insert_with(|| uuid::Uuid::new_v4().to_string()).clone();
        state.sessions.lock().unwrap().insert(token.clone(), Some(session_id.into()));
        token
    }

    pub fn is_transport(&self, token: &str) -> bool {
        self.transport.get().is_some_and(|value| value == token)
    }

    async fn drain(
        &self, app: &tauri::AppHandle, session_id: &str, token: &str, targets: &[String], kind: &str,
    ) -> Result<(), String> {
        let state = app.state::<BrowserAi>();
        let alive = self.worker.lock().await.as_ref().is_some_and(|worker| worker.alive.load(Ordering::Acquire));
        if alive {
            let result =
                self.request(app, json!({"kind":kind,"sessionId":session_id,"token":token,"targets":targets})).await?;
            for target in result["targets"].as_array().ok_or("Missing drained targets")? {
                if target["disconnected"] == true {
                    let label = target["target"].as_str().ok_or("Missing drained target")?;
                    tokio::time::timeout(Duration::from_secs(10), async {
                        loop {
                            let detached = state.detached.notified();
                            tokio::pin!(detached);
                            detached.as_mut().enable();
                            if !state.leases.lock().unwrap().contains_key(label) {
                                break;
                            }
                            detached.await;
                        }
                    })
                    .await
                    .map_err(|_| "Browser transport has not detached; control remains stopping")?;
                }
            }
        }
        let mut controls = state.controls.lock().unwrap();
        for target in targets {
            if controls.get(target).is_some_and(|c| c.token == token && c.stopping) {
                controls.remove(target);
            }
        }
        drop(controls);
        let _ = app.emit_to("main", "browser-control-changed", ());
        Ok(())
    }

    pub async fn release_target(&self, app: &tauri::AppHandle, label: &str, token: Option<&str>) -> Result<(), String> {
        let state = app.state::<BrowserAi>();
        let control = {
            let mut controls = state.controls.lock().unwrap();
            let Some(control) = controls.get_mut(label) else { return Ok(()) };
            if let Some(token) = token {
                if token != control.token {
                    return Err("Tab is controlled by another conversation".into());
                }
            } else {
                state.blocked.lock().unwrap().insert((control.token.clone(), label.into()));
            }
            if control.stopping {
                return Err("Tab control is already stopping".into());
            }
            control.stopping = true;
            control.clone()
        };
        let _ = app.emit_to("main", "browser-control-changed", ());
        self.drain(app, &control.session_id, &control.token, &[label.into()], "releaseTarget").await
    }

    pub async fn release(&self, app: &tauri::AppHandle, session_id: &str) -> Result<(), String> {
        let state = app.state::<BrowserAi>();
        let (token, targets) = {
            let mut tokens = self.tokens.lock().unwrap();
            let token = tokens.remove(session_id);
            let mut sessions = state.sessions.lock().unwrap();
            sessions.retain(|_, id| id.as_deref() != Some(session_id));
            let mut controls = state.controls.lock().unwrap();
            let targets = controls
                .iter_mut()
                .filter_map(|(label, control)| {
                    if control.session_id != session_id {
                        return None;
                    }
                    control.stopping = true;
                    Some(label.clone())
                })
                .collect::<Vec<_>>();
            (token, targets)
        };
        let _ = app.emit_to("main", "browser-control-changed", ());
        if let Some(token) = token {
            self.drain(app, session_id, &token, &targets, "release").await?;
            state.blocked.lock().unwrap().retain(|(key, _)| key != &token);
        } else {
            // Diagnostic HTTP calls may hold control without ever opening a socket.
            let leases = state.leases.lock().unwrap();
            state
                .controls
                .lock()
                .unwrap()
                .retain(|label, control| control.session_id != session_id || leases.contains_key(label));
            let _ = app.emit_to("main", "browser-control-changed", ());
        }
        Ok(())
    }

    /// Runtime is the authority for turn completion; a connected socket is not an active turn.
    pub async fn release_all(&self, app: &tauri::AppHandle) {
        let sessions = app.state::<BrowserAi>().sessions.lock().unwrap().values().flatten().cloned().collect();
        self.release_sessions(app, sessions).await;
    }

    pub async fn sync_states(&self, app: &tauri::AppHandle, states: &[alwith_api::SessionRunState]) {
        self.release_sessions(app, finished_sessions(states.iter().map(|state| (&state.session_id, &state.state))))
            .await;
    }

    async fn release_sessions(&self, app: &tauri::AppHandle, sessions: std::collections::HashSet<String>) {
        for session in sessions {
            if let Err(error) = self.release(app, &session).await {
                log::error!("Browser cleanup for {session} failed: {error}");
            }
        }
    }
}

fn finished_sessions<'a>(
    states: impl Iterator<Item = (&'a String, &'a alwith_api::RunState)>,
) -> std::collections::HashSet<String> {
    states
        .filter(|(_, state)| matches!(state, alwith_api::RunState::Done | alwith_api::RunState::Idle))
        .map(|(session, _)| session.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_turns_release_control_without_touching_running_or_approval_turns() {
        use alwith_api::RunState::*;
        let states = [
            ("done".into(), Done),
            ("idle".into(), Idle),
            ("running".into(), Running),
            ("approval".into(), RequiresAction),
        ];
        assert_eq!(
            finished_sessions(states.iter().map(|(id, state)| (id, state))),
            ["done".into(), "idle".into()].into()
        );
    }
}

#[tauri::command]
pub async fn web_automation_execute(
    webview: tauri::Webview, session_id: String, name: String, args: Value,
) -> Result<Value, String> {
    crate::browser_ai::main(&webview)?;
    if session_id.is_empty() || !name.starts_with("browser_") || !args.is_object() {
        return Err("Invalid web automation request".into());
    }
    let app = webview.app_handle();
    let state = app.state::<BrowserAi>();
    let token = state.executor.token(&state, &session_id);
    if name == "browser_release" {
        let label = args["target"].as_str().ok_or("An explicit guest target is required")?;
        state.executor.release_target(app, label, Some(&token)).await?;
        return Ok(json!({"ok":true,"target":label,"released":true}));
    }
    let transport = state.executor.transport.get_or_init(|| uuid::Uuid::new_v4().to_string());
    let endpoint = state.endpoint.lock().unwrap().clone();
    state
        .executor
        .request(
            app,
            json!({"kind":"call","sessionId":session_id,"token":token,"transportToken":transport,"endpoint":endpoint,"name":name,"args":args}),
        )
        .await
}

#[tauri::command]
pub async fn web_automation_cancel(webview: tauri::Webview, session_id: String) -> Result<(), String> {
    crate::browser_ai::main(&webview)?;
    webview.state::<BrowserAi>().executor.release(webview.app_handle(), &session_id).await
}

#[tauri::command]
pub async fn web_automation_takeover(webview: tauri::Webview, target: String) -> Result<(), String> {
    crate::browser_ai::main(&webview)?;
    webview.state::<BrowserAi>().executor.release_target(webview.app_handle(), &target, None).await
}

#[tauri::command]
pub fn web_automation_controls(webview: tauri::Webview) -> Result<Value, String> {
    crate::browser_ai::main(&webview)?;
    Ok(json!(*webview.state::<BrowserAi>().controls.lock().unwrap()))
}
