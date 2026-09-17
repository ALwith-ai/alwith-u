//! Owns the `alwith-runtime` sidecar and relays its stdio to the webview, byte-for-byte:
//! `runtime_send` writes one frame to stdin; stdout frames are batched (16 ms window, like
//! Desktop's RuntimeLines) into `runtime:lines` events. Nothing here parses the protocol.
//! A webview reload re-subscribes and attaches to whatever the Runtime still runs.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub const LINES_EVENT: &str = "runtime:lines";
pub const EXIT_EVENT: &str = "runtime:exit";
const READY_TIMEOUT: Duration = Duration::from_secs(20);
/// Frames arriving within this window ship in one event: a Tauri emit per line is too costly
/// while an agent streams.
const BATCH_WINDOW: Duration = Duration::from_millis(16);
const BATCH_MAX_LINES: usize = 256;

#[derive(Default)]
pub struct RuntimeState {
    child: Mutex<Option<CommandChild>>,
    ready: Mutex<bool>,
    starting: tokio::sync::Mutex<()>,
}

/// How long the exit chain waits for the Runtime to leave on its own before killing it.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

impl RuntimeState {
    /// Exit chain: ask the Runtime to leave (`shutdown`; it gives modules and agents a 2 s window,
    /// then reaps every agent process group), wait for it to exit, kill only if it does not.
    /// A straight kill would leave the agents' process groups (a dev server a bash tool started)
    /// running after the app is gone. Synchronous on purpose: it runs from Tauri's exit hook.
    pub fn shutdown(&self) {
        let asked = match self.child.lock().unwrap().as_mut() {
            Some(child) => child.write(b"{\"id\":0,\"method\":\"shutdown\"}\n").is_ok(),
            None => false,
        };
        if asked {
            let deadline = std::time::Instant::now() + SHUTDOWN_GRACE;
            // The pump clears `child` when it sees the process terminate.
            while std::time::Instant::now() < deadline && self.child.lock().unwrap().is_some() {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        *self.ready.lock().unwrap() = false;
    }
}

/// Sidecars Tauri places next to the app executable (`bundle.externalBin`).
fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = exe.parent().ok_or("executable has no parent directory")?;
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let path = directory.join(file);
    if !path.is_file() {
        return Err(format!("sidecar {name} missing at {}", path.display()));
    }
    Ok(path)
}

fn engines_table() -> Result<String, String> {
    let adapter = sidecar_path("codex-acp-v2")?;
    let codex = sidecar_path("codex")?;
    Ok(serde_json::json!({
        "codex": {
            "command": adapter,
            "env": { "CODEX_PATH": codex }
        }
    })
    .to_string())
}

/// Starts alwith-runtime over stdio if it is not running and waits for its `ready` line.
#[tauri::command]
pub async fn runtime_start(app: AppHandle, state: State<'_, RuntimeState>) -> Result<(), String> {
    let _starting = state.starting.lock().await;
    if *state.ready.lock().unwrap() {
        return Ok(());
    }
    let journal = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("runtime")
        .join("sessions");
    let command = app
        .shell()
        .sidecar("alwith-runtime")
        .map_err(|error| error.to_string())?
        .args(["--listen", "stdio://"])
        .env("ALWITH_RUNTIME_ENGINES", engines_table()?)
        .env("ALWITH_RUNTIME_JOURNAL", &journal)
        .env("ALWITH_RUNTIME_PARENT_PID", std::process::id().to_string())
        .env("RUST_LOG", "info");
    let (mut events, child) = command.spawn().map_err(|error| error.to_string())?;
    log::info!("alwith-runtime started (pid {})", child.pid());
    *state.child.lock().unwrap() = Some(child);

    let ready = tokio::time::timeout(READY_TIMEOUT, async {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let value: serde_json::Value = match serde_json::from_str(line.trim()) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if value.get("type").and_then(|kind| kind.as_str()) == Some("ready") {
                        return Ok::<(), String>(());
                    }
                }
                CommandEvent::Stderr(bytes) => log::info!(
                    "[alwith-runtime] {}",
                    String::from_utf8_lossy(&bytes).trim_end()
                ),
                CommandEvent::Error(message) => return Err(format!("alwith-runtime: {message}")),
                CommandEvent::Terminated(payload) => {
                    return Err(format!(
                        "alwith-runtime exited before ready (code {:?}, signal {:?})",
                        payload.code, payload.signal
                    ));
                }
                _ => {}
            }
        }
        Err("alwith-runtime closed its output before ready".to_string())
    })
    .await
    .map_err(|_| "alwith-runtime did not report ready in time".to_string())
    .and_then(|result| result);
    if let Err(error) = ready {
        state.shutdown();
        return Err(error);
    }
    *state.ready.lock().unwrap() = true;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut batch: Vec<String> = Vec::new();
        let mut exit = (None, None);
        loop {
            let event = if batch.is_empty() {
                events.recv().await
            } else {
                match tokio::time::timeout(BATCH_WINDOW, events.recv()).await {
                    Ok(event) => event,
                    Err(_) => {
                        emit_lines(&handle, std::mem::take(&mut batch));
                        continue;
                    }
                }
            };
            match event {
                Some(CommandEvent::Stdout(bytes)) => {
                    batch.push(String::from_utf8_lossy(&bytes).trim_end().to_string());
                    if batch.len() >= BATCH_MAX_LINES {
                        emit_lines(&handle, std::mem::take(&mut batch));
                    }
                }
                Some(CommandEvent::Stderr(bytes)) => {
                    log::info!(
                        "[alwith-runtime] {}",
                        String::from_utf8_lossy(&bytes).trim_end()
                    );
                }
                Some(CommandEvent::Error(message)) => log::error!("[alwith-runtime] {message}"),
                Some(CommandEvent::Terminated(payload)) => exit = (payload.code, payload.signal),
                Some(_) => {}
                None => break,
            }
        }
        emit_lines(&handle, batch);
        log::info!(
            "alwith-runtime exited (code {:?}, signal {:?})",
            exit.0,
            exit.1
        );
        let state = handle.state::<RuntimeState>();
        state.child.lock().unwrap().take();
        *state.ready.lock().unwrap() = false;
        let _ = handle.emit(
            EXIT_EVENT,
            serde_json::json!({ "code": exit.0, "signal": exit.1 }),
        );
    });
    Ok(())
}

fn emit_lines(app: &AppHandle, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }
    let _ = app.emit(LINES_EVENT, lines);
}

/// One frame to the Runtime's stdin. The line is opaque here.
#[tauri::command]
pub fn runtime_send(state: State<'_, RuntimeState>, line: String) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    let child = guard.as_mut().ok_or("alwith-runtime is not running")?;
    let mut payload = line.into_bytes();
    payload.push(b'\n');
    child.write(&payload).map_err(|error| error.to_string())
}
