//! Thin transport for the shared device host. The native module owns devices, leases and logs.
use alwith_device::{AttachmentInfo, CrashReport, DeviceHost, LogPage, LogQuery, ManagedDevice, Owner, Registration};
use std::sync::Arc;
use tauri::{Manager, WebviewWindow};
use tauri3_specta::Event;

pub struct DeviceState {
    pub host: Arc<DeviceHost>,
}

#[derive(Clone, serde::Serialize, specta::Type, tauri3_specta::Event)]
#[serde(rename_all = "camelCase")]
#[event(name = "device:attachments")]
pub struct DeviceAttachments {
    revision: u64,
    attachments: Vec<AttachmentInfo>,
}

/// Without the native module the state stays unmanaged and every command reports it.
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(host) = DeviceHost::open() else {
        log::warn!("Device module missing; simulator features are disabled");
        return Ok(());
    };
    let host = Arc::new(host);
    tauri::async_runtime::block_on(host.listen())?;
    app.manage(DeviceState { host: host.clone() });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut revision = 0;
        loop {
            match host.changed_since(revision).await {
                Ok(next) if next != revision => {
                    revision = next;
                    if let Ok(attachments) = host.attachments() {
                        let _ = DeviceAttachments { revision, attachments }.emit(&handle);
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    log::warn!("Device attachment watcher stopped: {error}");
                    break;
                }
            }
        }
    });
    Ok(())
}

fn check_surface(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "chat" | "settings") {
        Ok(())
    } else {
        Err("Device controls are unavailable in this window".into())
    }
}
fn host(window: &WebviewWindow) -> Result<Arc<DeviceHost>, String> {
    check_surface(window)?;
    window
        .app_handle()
        .try_state::<DeviceState>()
        .map(|state| state.host.clone())
        .ok_or_else(|| "Simulator support is not installed in this build".into())
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCarrier {
    command: String,
    args: Vec<String>,
    proxy: String,
}
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSessionConnection {
    registration: Registration,
    carrier: DeviceCarrier,
}

/// A fresh gateway token for one conversation plus the carrier the agent runtime launches.
#[tauri3_specta::command]
pub fn device_context(window: WebviewWindow) -> Result<Option<DeviceSessionConnection>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let Ok(host) = host(&window) else { return Ok(None) };
    let registration = host.register()?;
    let resources = if tauri::is_dev() {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        window.app_handle().path().resource_dir().map_err(|e| e.to_string())?
    };
    let proxy = resources.join("device/stdio.mjs");
    if !proxy.is_file() {
        return Err(format!("Device proxy missing at {}", proxy.display()));
    }
    Ok(Some(DeviceSessionConnection {
        registration,
        carrier: DeviceCarrier {
            command: crate::runtime::sidecar_path("bun")?.to_string_lossy().into_owned(),
            args: vec!["--no-install".into()],
            proxy: proxy.to_string_lossy().into_owned(),
        },
    }))
}
#[tauri3_specta::command]
pub fn device_bind(window: WebviewWindow, token: String, session_id: String) -> Result<(), String> {
    let host = host(&window)?;
    host.bind(&token, &session_id)
}
#[tauri3_specta::command]
pub async fn device_stop_session(window: WebviewWindow, session_id: String) -> Result<(), String> {
    let host = host(&window)?;
    host.stop_session(&session_id).await
}
#[tauri3_specta::command]
pub async fn device_list(window: WebviewWindow, platform: String) -> Result<Vec<ManagedDevice>, String> {
    let host = host(&window)?;
    host.list(&platform).await
}
#[tauri3_specta::command]
pub fn device_attachments(window: WebviewWindow) -> Result<Vec<AttachmentInfo>, String> {
    let host = host(&window)?;
    host.attachments()
}
/// The panel attaches on behalf of its conversation so the agent's tools see the same device.
#[tauri3_specta::command]
pub async fn device_attach(
    window: WebviewWindow, session_id: String, platform: String, udid: Option<String>,
) -> Result<AttachmentInfo, String> {
    let host = host(&window)?;
    host.attach(Owner::DevelopmentSession(session_id), &platform, udid.as_deref(), true).await
}
#[tauri3_specta::command]
pub async fn device_detach(window: WebviewWindow, udid: String) -> Result<(), String> {
    let host = host(&window)?;
    host.detach(&udid, None).await
}
/// A PNG data URL of the current screen for the polling preview.
#[tauri3_specta::command]
pub async fn device_frame(window: WebviewWindow, udid: String) -> Result<String, String> {
    let host = host(&window)?;
    Ok(format!("data:image/png;base64,{}", host.screenshot(&udid).await?))
}
/// Input needs the native simulator helper, which this version does not ship yet.
#[tauri3_specta::command]
pub async fn device_gesture(window: WebviewWindow, udid: String, gesture: serde_json::Value) -> Result<(), String> {
    host(&window)?;
    let _ = (udid, gesture);
    Err("Input is not available until the simulator helper ships".into())
}
#[tauri3_specta::command]
pub async fn device_appearance(window: WebviewWindow, udid: String) -> Result<String, String> {
    let host = host(&window)?;
    host.appearance(&udid).await
}
#[tauri3_specta::command]
pub async fn device_set_appearance(window: WebviewWindow, udid: String, mode: String) -> Result<(), String> {
    let host = host(&window)?;
    host.set_appearance(&udid, &mode).await
}
#[tauri3_specta::command]
pub async fn device_set_status_bar(window: WebviewWindow, udid: String, look: String) -> Result<(), String> {
    let host = host(&window)?;
    host.set_status_bar(&udid, &look).await
}
#[tauri3_specta::command]
pub async fn device_shutdown(window: WebviewWindow, udid: String) -> Result<(), String> {
    let host = host(&window)?;
    host.shutdown_device(&udid).await
}
#[tauri3_specta::command]
pub async fn device_restart(window: WebviewWindow, udid: String) -> Result<(), String> {
    let host = host(&window)?;
    host.restart_device(&udid).await
}
/// Save the current screen as a PNG on the Desktop and return its path.
#[tauri3_specta::command]
pub async fn device_save_screenshot(window: WebviewWindow, udid: String) -> Result<String, String> {
    use base64::Engine;
    let host = host(&window)?;
    let encoded = host.screenshot(&udid).await?;
    let png = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    let resolver = window.app_handle().path();
    let directory = resolver.desktop_dir().or_else(|_| resolver.home_dir()).map_err(|e| e.to_string())?;
    let name = host
        .attachments()?
        .into_iter()
        .find(|info| info.udid == udid)
        .map(|info| info.device_name)
        .unwrap_or_else(|| "Simulator".into());
    let path = directory.join(format!("{name} {}.png", file_stamp()));
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&target, png))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
/// A sortable UTC stamp without pulling a date crate into the host.
fn file_stamp() -> String {
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let (days, rest) = (seconds / 86_400, seconds % 86_400);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {:02}.{:02}.{:02}", rest / 3600, (rest % 3600) / 60, rest % 60)
}
#[tauri3_specta::command]
pub async fn device_logs(window: WebviewWindow, udid: String, query: LogQuery) -> Result<LogPage, String> {
    let host = host(&window)?;
    host.read_logs(&udid, query).await
}
#[tauri3_specta::command]
pub fn device_crash_report(
    window: WebviewWindow, udid: String, bundle_id: Option<String>,
) -> Result<Option<CrashReport>, String> {
    let host = host(&window)?;
    host.crash_report(&udid, bundle_id.as_deref())
}
