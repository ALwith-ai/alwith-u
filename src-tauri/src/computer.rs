//! Thin transport for the shared computer host. The native host owns all grants.
use alwith_computer::{ComputerHost, Connection, permissions};
use tauri::{Manager, State, WebviewWindow};

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let directory = exe.parent().ok_or("Application executable has no parent")?;
    let name = if cfg!(windows) { "cua-driver.exe" } else { "cua-driver" };
    // Tauri places staged sidecars beside the host executable in development and release.
    app.manage(
        ComputerHost::new(directory.join(name), app.config().identifier.clone()).with_cursor_theme(
            "ai.alwith.u".into(),
            include_bytes!("../assets/computer/ai.alwith.u.cua-theme").to_vec(),
        ),
    );
    let gateway = ComputerGateway::default();
    tauri::async_runtime::block_on(gateway.gateway.listen())?;
    app.manage(gateway);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            let gateway = handle.state::<ComputerGateway>();
            let _lifecycle = gateway.lifecycle.lock().await;
            if gateway.gateway.faulted() {
                *gateway.failure.lock().unwrap() = Some("Computer connection failed during an action. Its outcome may be unknown; reconnect and observe before retrying.".into());
                log::error!(
                    "Computer transport failed during a native action; stopping the driver before releasing ownership"
                );
                if handle.state::<ComputerHost>().stop_current().await.is_ok() {
                    gateway.gateway.stop_all();
                }
            }
        }
    });
    Ok(())
}

// A single application grant is intentionally shared by every Codex session.
const APPLICATION_GRANT: &str = "application";

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    permissions: permissions::Permissions,
    available: bool,
    enabled: bool,
    version: String,
    phase: String,
    last_error: Option<String>,
    diagnostics: String,
}
fn check_surface(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "chat" | "settings") {
        Ok(())
    } else {
        Err("Computer settings are unavailable in this window".into())
    }
}
fn status(state: &ComputerHost, gateway: &ComputerGateway) -> Result<ComputerStatus, String> {
    let state = state.status()?;
    let failure = gateway.failure.lock().unwrap().clone();
    Ok(ComputerStatus {
        permissions: state.permissions,
        available: state.available,
        enabled: state.ready,
        version: state.version,
        phase: if failure.is_some() { "failed".into() } else { state.phase },
        last_error: state.last_error.or(failure),
        diagnostics: format!("{}\n{}", state.diagnostics, gateway.gateway.diagnostics()),
    })
}
#[tauri3_specta::command]
pub fn computer_status(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>,
) -> Result<ComputerStatus, String> {
    check_surface(&window)?;
    status(&state, &gateway)
}
#[tauri3_specta::command]
pub async fn computer_request_permissions(
    window: WebviewWindow, permission: String, request: bool,
) -> Result<(), String> {
    check_surface(&window)?;
    #[cfg(target_os = "macos")]
    {
        let mask = match permission.as_str() {
            "accessibility" => 1,
            "screenCapture" => 2,
            _ => return Err("Unknown computer permission".into()),
        };
        let permission = match permission.as_str() {
            "accessibility" => macos_privacy::Permission::Accessibility,
            "screenCapture" => macos_privacy::Permission::ScreenRecording,
            _ => return Err("Unknown computer permission".into()),
        };
        // Opening Settings is independent of the one-shot OS prompt. Never queue both
        // permission dialogs or await the user's decision on the UI thread.
        macos_privacy::open_settings(permission).map_err(|e| e.to_string())?;
        static PROMPTED: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
        if request && PROMPTED.fetch_or(mask, std::sync::atomic::Ordering::AcqRel) & mask == 0 {
            window
                .run_on_main_thread(move || {
                    if let Err(error) = macos_privacy::prompt(permission) {
                        log::error!("Computer permission prompt failed: {error}");
                    }
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (permission, request);
        Ok(())
    }
}
#[tauri3_specta::command]
pub async fn computer_start(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>,
) -> Result<ComputerStatus, String> {
    check_surface(&window)?;
    let _lifecycle = gateway.lifecycle.lock().await;
    if gateway.gateway.faulted() {
        state.stop_current().await?;
        gateway.gateway.stop_all();
    }
    state.start(APPLICATION_GRANT.into()).await?;
    *gateway.failure.lock().unwrap() = None;
    status(&state, &gateway)
}
#[tauri3_specta::command]
pub async fn computer_stop(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>,
) -> Result<(), String> {
    check_surface(&window)?;
    let _lifecycle = gateway.lifecycle.lock().await;
    state.stop_current().await?;
    gateway.gateway.stop_all();
    Ok(())
}
/// Never replays actions: fresh driver and MCP generation, then a new observation.
#[tauri3_specta::command]
pub async fn computer_reconnect(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>,
) -> Result<ComputerStatus, String> {
    check_surface(&window)?;
    let _lifecycle = gateway.lifecycle.lock().await;
    state.stop_current().await?;
    gateway.gateway.stop_all();
    state.start(APPLICATION_GRANT.into()).await?;
    *gateway.failure.lock().unwrap() = None;
    status(&state, &gateway)
}
#[tauri3_specta::command]
pub fn computer_context(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>,
) -> Result<Option<SessionConnection>, String> {
    check_surface(&window)?;
    let Some(connection) = state.connection(APPLICATION_GRANT)? else { return Ok(None) };
    let permissions = state.status()?.permissions;
    if !permissions.accessibility || !permissions.screen_capture {
        return Err("Computer permissions were revoked; restore them in Settings before retrying".into());
    }
    let generation = connection.generation.clone();
    let (token, address) = gateway.gateway.register(connection)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let directory = exe.parent().ok_or("Missing executable directory")?;
    let resources = if tauri::is_dev() {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        window.app_handle().path().resource_dir().map_err(|e| e.to_string())?
    };
    let proxy = resources.join("computer/stdio.mjs");
    if !proxy.is_file() {
        return Err(format!("Computer proxy missing at {}", proxy.display()));
    }
    Ok(Some(SessionConnection {
        token: token.clone(),
        connection: Connection {
            generation,
            command: directory.join(if cfg!(windows) { "bun.exe" } else { "bun" }).to_string_lossy().into(),
            args: vec!["--no-install".into(), proxy.to_string_lossy().into(), address, token],
            env: vec![],
        },
    }))
}

#[derive(Default)]
pub struct ComputerGateway {
    lifecycle: tokio::sync::Mutex<()>,
    failure: std::sync::Mutex<Option<String>>,
    pub gateway: std::sync::Arc<alwith_computer::gateway::Gateway>,
    subscriptions: std::sync::Mutex<std::collections::HashMap<String, (String, tokio::sync::watch::Sender<bool>)>>,
}
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionConnection {
    connection: Connection,
    token: String,
}

#[tauri3_specta::command]
pub fn computer_revision(window: WebviewWindow, state: State<'_, ComputerHost>) -> Result<String, String> {
    check_surface(&window)?;
    Ok(state.connection(APPLICATION_GRANT)?.map_or_else(|| "disabled".into(), |c| c.generation))
}
#[tauri3_specta::command]
pub async fn computer_ready(
    window: WebviewWindow, state: State<'_, ComputerHost>, gateway: State<'_, ComputerGateway>, session_id: String,
) -> Result<(), String> {
    check_surface(&window)?;
    if state.connection(APPLICATION_GRANT)?.is_none() {
        return Ok(());
    }
    let permissions = state.status()?.permissions;
    if !permissions.accessibility || !permissions.screen_capture {
        return Err("Computer permissions were revoked; restore them in Settings before retrying".into());
    }
    gateway.gateway.ensure_ready(&session_id).await
}
#[tauri3_specta::command]
pub fn computer_bind(
    window: WebviewWindow, state: State<'_, ComputerGateway>, token: String, session_id: String,
) -> Result<(), String> {
    check_surface(&window)?;
    state.gateway.bind(&token, &session_id)
}
#[tauri3_specta::command]
pub fn computer_stop_session(
    window: WebviewWindow, state: State<'_, ComputerGateway>, session_id: String,
) -> Result<(), String> {
    check_surface(&window)?;
    state.gateway.stop_session(&session_id);
    Ok(())
}
#[derive(Clone, serde::Serialize, specta::Type, tauri3_specta::Event)]
#[serde(rename_all = "camelCase")]
#[event(name = "computer:preview")]
pub struct ComputerPreview {
    subscription_id: String,
    activity: alwith_computer::gateway::Activity,
    frame: Option<alwith_computer::preview::Frame>,
    error: Option<String>,
}
#[tauri3_specta::command]
pub fn computer_subscribe(
    window: WebviewWindow, state: State<'_, ComputerGateway>, session_id: String, subscription_id: String,
) -> Result<(), String> {
    check_surface(&window)?;
    if session_id.is_empty() || subscription_id.is_empty() {
        return Err("Missing preview identity".into());
    }
    let (stop, mut cancelled) = tokio::sync::watch::channel(false);
    if let Some(previous) =
        state.subscriptions.lock().unwrap().insert(window.label().into(), (subscription_id.clone(), stop))
    {
        previous.1.send_replace(true);
    }
    let gateway = state.gateway.clone();
    tauri::async_runtime::spawn(async move {
        use tauri3_specta::Event;
        loop {
            let Ok(visible) = window.is_visible() else { break };
            let Ok(minimized) = window.is_minimized() else { break };
            if visible && !minimized {
                let activity = gateway.activity(&session_id);
                let mut frame = None;
                let mut error = None;
                if let Some(target) = activity.target.clone() {
                    let cursor = gateway.cursor_position(&session_id).await;
                    match tokio::task::spawn_blocking(move || alwith_computer::preview::capture(&target, cursor)).await
                    {
                        Ok(Ok(image)) => frame = Some(image),
                        Ok(Err(e)) => error = Some(e),
                        Err(e) => error = Some(e.to_string()),
                    }
                }
                let current = gateway.activity(&session_id);
                if current.revision == activity.revision
                    && current.phase == activity.phase
                    && !*cancelled.borrow()
                    && (ComputerPreview { subscription_id: subscription_id.clone(), activity, frame, error })
                        .emit_to(&window, tauri::EventTarget::WebviewWindow { label: window.label().into() })
                        .is_err()
                {
                    break;
                }
            }
            tokio::select! {_=cancelled.changed()=>break,_=tokio::time::sleep(std::time::Duration::from_millis(500))=>{}}
        }
    });
    Ok(())
}
#[tauri3_specta::command]
pub fn computer_unsubscribe(
    window: WebviewWindow, state: State<'_, ComputerGateway>, subscription_id: String,
) -> Result<(), String> {
    check_surface(&window)?;
    let mut subscriptions = state.subscriptions.lock().unwrap();
    if subscriptions.get(window.label()).is_some_and(|(id, _)| id == &subscription_id)
        && let Some((_, stop)) = subscriptions.remove(window.label())
    {
        stop.send_replace(true);
    }
    Ok(())
}

#[tauri3_specta::command]
pub async fn computer_focus(
    window: WebviewWindow, gateway: State<'_, ComputerGateway>, session_id: String, revision: u64,
) -> Result<(), String> {
    check_surface(&window)?;
    gateway.gateway.focus_preview(&session_id, revision).await
}
