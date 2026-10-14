//! Host policy and transport for the shared Gamepad service.
use alwith_gamepad::{
    capture::CaptureSession,
    contract::{EngineState, Request},
    service::GamepadService,
};
use serde_json::Value;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};

struct CaptureOwner {
    window: String,
    session: CaptureSession,
    #[cfg(not(target_os = "windows"))]
    menu: Option<tauri::menu::Menu<tauri::DynRuntime>>,
}
#[derive(Default)]
struct CaptureEpoch(AtomicU64);
impl CaptureEpoch {
    fn ticket(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
    fn invalidate(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn check(&self, ticket: u64, focused: bool) -> Result<(), String> {
        if ticket == self.ticket() && focused {
            Ok(())
        } else {
            Err("Key capture was cancelled because window focus changed".into())
        }
    }
}
pub struct GamepadState {
    service: Result<Arc<GamepadService>, String>,
    capture: Mutex<Option<CaptureOwner>>,
    capture_epoch: CaptureEpoch,
}
impl GamepadState {
    fn service(&self) -> Result<Arc<GamepadService>, String> {
        self.service.clone()
    }
}
pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let events = app.clone();
    let service = GamepadService::new(
        app.path().app_data_dir()?.join("gamepad/profiles.json"),
        std::env::temp_dir().join("alwith-gamepad-injection.lock"),
        move |event| {
            for label in ["main", "settings", "gamepad"] {
                if let Err(error) = events.emit_to(label, "gamepad:event", &event) {
                    log::error!("Cannot deliver Gamepad event: {error}");
                }
            }
        },
    )
    .map(Arc::new);
    app.manage(GamepadState { service, capture: Mutex::new(None), capture_epoch: CaptureEpoch::default() });
    Ok(())
}
fn authorize(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "settings" | "gamepad") {
        Ok(())
    } else {
        Err("Gamepad is available only to application windows".into())
    }
}
#[tauri3_specta::command]
pub async fn gamepad_request(
    window: tauri::WebviewWindow, state: tauri::State<'_, GamepadState>, request: Value,
) -> Result<Value, String> {
    authorize(window.label())?;
    let request: Request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    // Capture suspension belongs to the native host, never to renderer callers.
    if matches!(request, Request::Suspend { .. } | Request::Resume { .. }) {
        return Err("Input suspension is managed by the host".into());
    }
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || {
        service.execute(request).and_then(|response| serde_json::to_value(response).map_err(|e| e.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri3_specta::command]
pub async fn gamepad_permission(window: tauri::WebviewWindow, operation: String) -> Result<Value, String> {
    authorize(window.label())?;
    #[cfg(target_os = "macos")]
    {
        use macos_privacy::Permission;
        match operation.as_str() {
            "status" => {}
            "request" => macos_privacy::prompt(Permission::Accessibility).map_err(|e| e.to_string())?,
            "settings" => macos_privacy::open_settings(Permission::Accessibility).map_err(|e| e.to_string())?,
            "bluetooth" => {
                open::that("x-apple.systempreferences:com.apple.BluetoothSettings").map_err(|e| e.to_string())?;
            }
            _ => return Err("Unknown Gamepad permission operation".into()),
        }
        let authorized = macos_privacy::status(Permission::Accessibility).is_authorized();
        Ok(serde_json::json!({ "authorized": authorized, "mayPrompt": !authorized, "known": null }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        match operation.as_str() {
            "status" | "request" | "settings" => {}
            "bluetooth" => {
                #[cfg(target_os = "windows")]
                open::that("ms-settings:bluetooth").map_err(|e| e.to_string())?;
                #[cfg(target_os = "linux")]
                std::process::Command::new("gnome-control-center")
                    .arg("bluetooth")
                    .spawn()
                    .map_err(|error| error.to_string())?;
                #[cfg(not(any(target_os = "windows", target_os = "linux")))]
                return Err("Bluetooth settings are not supported on this platform".into());
            }
            _ => return Err("Unknown Gamepad permission operation".into()),
        }
        Ok(serde_json::json!({ "authorized": true, "mayPrompt": false, "known": null }))
    }
}
fn stop_capture(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<GamepadState>();
    let mut capture = state.capture.lock().unwrap();
    if capture.as_ref().is_some_and(|owner| owner.window == label) {
        let owner = capture.take().expect("capture owner exists");
        drop(owner.session);
        #[cfg(not(target_os = "windows"))]
        let menu_result = owner.menu.map_or(Ok(()), |menu| app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string()));
        let resume_result = state.service()?.execute(Request::Resume { token: format!("capture:{label}") });
        #[cfg(not(target_os = "windows"))]
        menu_result?;
        resume_result?;
    }
    Ok(())
}
#[tauri3_specta::command]
pub async fn gamepad_capture(window: tauri::WebviewWindow, app: tauri::AppHandle, start: bool) -> Result<(), String> {
    authorize(window.label())?;
    let label = window.label().to_string();
    let ticket = app.state::<GamepadState>().capture_epoch.ticket();
    tauri::async_runtime::spawn_blocking(move || {
        if !start {
            return stop_capture(&app, &label);
        }
        let state = app.state::<GamepadState>();
        let service = state.service()?;
        let mut capture = state.capture.lock().unwrap();
        if capture.is_some() {
            return Err("Another key capture session is active".into());
        }
        state.capture_epoch.check(ticket, window.is_focused().map_err(|error| error.to_string())?)?;
        if service.snapshot().state != EngineState::Running {
            return Err("Start Gamepad before recording keys".into());
        }
        service.execute(Request::Suspend { token: format!("capture:{label}") })?;
        #[cfg(not(target_os = "windows"))]
        let menu = match app.remove_menu() {
            Ok(menu) => menu,
            Err(error) => {
                service.execute(Request::Resume { token: format!("capture:{label}") })?;
                return Err(error.to_string());
            }
        };
        let events = app.clone();
        let target = label.clone();
        let session = CaptureSession::start(Arc::new(move |event| {
            if let Err(error) = events.emit_to(&target, "gamepad:capture-key", event) {
                log::error!("Cannot deliver captured keys: {error}");
            }
        }));
        let session = session.and_then(|session| {
            // An OS hook may initialize while a blur event invalidates this request.
            state.capture_epoch.check(ticket, window.is_focused().map_err(|error| error.to_string())?)?;
            Ok(session)
        });
        match session {
            Ok(session) => {
                *capture = Some(CaptureOwner {
                    window: label,
                    session,
                    #[cfg(not(target_os = "windows"))]
                    menu,
                });
                Ok(())
            }
            Err(error) => {
                #[cfg(not(target_os = "windows"))]
                let menu_result = menu.map_or(Ok(()), |menu| app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string()));
                let resume_result = service.execute(Request::Resume { token: format!("capture:{label}") });
                #[cfg(not(target_os = "windows"))]
                if let Err(cleanup) = menu_result {
                    return Err(format!("{error}; restoring menu failed: {cleanup}"));
                }
                resume_result?;
                Err(error)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn window_inactive(app: &tauri::AppHandle, label: &str) {
    app.state::<GamepadState>().capture_epoch.invalidate();
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = stop_capture(&app, &label) {
            log::error!("Cannot release key capture: {error}");
        }
    });
}
/// Native teardown does not depend on JavaScript unload handlers completing.
pub fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    window_inactive(app, label);
    if label != "gamepad" {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let native = app.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            let state = native.state::<GamepadState>();
            let service = state.service()?;
            if service.snapshot().state == EngineState::Running {
                service.execute(Request::VirtualDetach)?;
            }
            Ok::<(), String>(())
        })
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => log::error!("Cannot detach destroyed Gamepad window's virtual device: {error}"),
            Err(error) => log::error!("Gamepad teardown task failed: {error}"),
        }
        let runtime = app.state::<crate::runtime::RuntimeState>();
        let client = match runtime.current() {
            Ok(client) => client,
            Err(error) => {
                log::error!("Cannot access Runtime for Gamepad teardown: {error}");
                return;
            }
        };
        let agents = match client.agents().await {
            Ok(agents) => agents,
            Err(error) => {
                log::error!("Cannot list Gamepad temporary agents: {}", crate::runtime::request_error(error));
                return;
            }
        };
        for agent in agents {
            if let Some(id) = agent.get("agentId").and_then(Value::as_str).filter(|id| is_temporary_agent(id))
                && let Err(error) = client.stop(id, None).await
            {
                log::error!("Cannot stop Gamepad temporary agent {id}: {}", crate::runtime::request_error(error));
            }
        }
    });
}

fn is_temporary_agent(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("gamepad-config-") else {
        return false;
    };
    suffix.len() == 36
        && suffix.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) { byte == b'-' } else { byte.is_ascii_hexdigit() }
        })
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<GamepadState>();
    if let Some(owner) = state.capture.lock().unwrap().take() {
        drop(owner.session);
    }
    if let Ok(service) = state.service()
        && let Err(error) = service.execute(Request::Stop)
    {
        log::error!("Cannot stop Gamepad: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{CaptureEpoch, authorize, is_temporary_agent};

    #[test]
    fn destroyed_window_targets_only_valid_gamepad_agents() {
        assert!(is_temporary_agent("gamepad-config-00000000-0000-4000-8000-000000000000"));
        for id in [
            "codex",
            "gamepad-config-test",
            "gamepad-config-000000000000000000000000000000000000",
            "chat-00000000-0000-4000-8000-000000000000",
        ] {
            assert!(!is_temporary_agent(id), "must preserve {id}");
        }
    }

    #[test]
    fn only_application_windows_can_access_gamepad() {
        for label in ["main", "settings", "gamepad"] {
            assert!(authorize(label).is_ok());
        }
        assert!(authorize("untrusted").is_err());
    }

    #[test]
    fn blur_cancels_pending_start_even_after_focus_returns() {
        let epoch = CaptureEpoch::default();
        let pending_start = epoch.ticket();
        epoch.invalidate();
        assert!(epoch.check(pending_start, true).is_err());
        assert!(epoch.check(epoch.ticket(), true).is_ok());
        assert!(epoch.check(epoch.ticket(), false).is_err());
    }

    #[test]
    fn blur_during_hook_initialization_invalidates_the_second_check() {
        let epoch = CaptureEpoch::default();
        let ticket = epoch.ticket();
        assert!(epoch.check(ticket, true).is_ok());
        epoch.invalidate();
        assert!(epoch.check(ticket, true).is_err());
    }
}

/// Native catalogs use cached snapshots while refreshing application icons off-thread.
#[tauri3_specta::command]
pub async fn gamepad_catalog(
    window: tauri::WebviewWindow, app: tauri::AppHandle, operation: String, path: Option<String>,
) -> Result<Value, String> {
    use alwith_gamepad::desktop::{applications, microphones};
    use tauri::async_runtime::spawn_blocking;
    authorize(window.label())?;
    match operation.as_str() {
        "applications" | "launchable" => {
            let launchable = operation == "launchable";
            let cached =
                spawn_blocking(
                    move || {
                        if launchable { applications::launchable_cached() } else { applications::cached() }
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
            let initial = match cached {
                Some(ref cached) => cached.clone(),
                None => spawn_blocking(move || {
                    if launchable { applications::launchable_rescan() } else { applications::names_only() }
                })
                .await
                .map_err(|error| error.to_string())?,
            };
            if cached.is_some() || !launchable {
                let baseline = initial.clone();
                tauri::async_runtime::spawn(async move {
                    let refresh = spawn_blocking(move || {
                        if launchable { applications::launchable_rescan() } else { applications::rescan() }
                    })
                    .await;
                    match refresh {
                        Ok(fresh) if fresh != baseline => {
                            let event = if launchable {
                                "gamepad:launchable-apps-updated"
                            } else {
                                "gamepad:applications-updated"
                            };
                            for label in ["main", "settings", "gamepad"] {
                                if let Err(error) = app.emit_to(label, event, &fresh) {
                                    log::error!("Cannot deliver Gamepad catalog update: {error}");
                                }
                            }
                        }
                        Ok(_) => {}
                        Err(error) => log::error!("Cannot refresh Gamepad catalog: {error}"),
                    }
                });
            }
            serde_json::to_value(initial).map_err(|error| error.to_string())
        }
        "icon" => {
            let path = path.ok_or_else(|| "Application icon path is required".to_string())?;
            let icon = spawn_blocking(move || applications::read_app_icon_at(&path))
                .await
                .map_err(|error| error.to_string())?;
            serde_json::to_value(icon).map_err(|error| error.to_string())
        }
        "microphones" => {
            let devices = spawn_blocking(microphones).await.map_err(|error| error.to_string())??;
            serde_json::to_value(devices).map_err(|error| error.to_string())
        }
        _ => Err("Unknown Gamepad catalog operation".into()),
    }
}
