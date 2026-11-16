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
use tauri::Manager;
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

    pub async fn release(&self, app: &tauri::AppHandle, session_id: &str) -> Result<(), String> {
        let token = self.tokens.lock().unwrap().remove(session_id);
        if let Some(token) = token {
            app.state::<BrowserAi>().sessions.lock().unwrap().remove(&token);
            self.request(app, json!({"kind":"release","sessionId":session_id,"token":token})).await?;
        }
        Ok(())
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
    let endpoint = state.endpoint.lock().unwrap().clone();
    state
        .executor
        .request(
            app,
            json!({"kind":"call","sessionId":session_id,"token":token,"endpoint":endpoint,"name":name,"args":args}),
        )
        .await
}

#[tauri::command]
pub async fn web_automation_cancel(webview: tauri::Webview, session_id: String) -> Result<(), String> {
    crate::browser_ai::main(&webview)?;
    webview.state::<BrowserAi>().executor.release(webview.app_handle(), &session_id).await
}
