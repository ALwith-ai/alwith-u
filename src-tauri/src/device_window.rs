//! Device presentation windows retain the application's device session.
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct DeviceWindows(Mutex<HashMap<String, DeviceWindow>>);
struct DeviceWindow {
    label: String,
    device_id: Option<String>,
}

#[tauri::command]
pub async fn device_window_open(
    window: tauri::Window, session_id: String, at_cursor: bool, device_id: Option<String>,
) -> Result<String, String> {
    if window.label() != "main" || session_id.is_empty() {
        return Err("Device windows require a main-window session".into());
    }
    let app = window.app_handle();
    let label = format!("device-{}", uuid::Uuid::new_v4());
    {
        let state = app.state::<DeviceWindows>();
        let mut entries = state.0.lock().unwrap();
        if let Some(entry) = entries.get(&session_id) {
            let label = &entry.label;
            let existing = app.get_webview_window(label).ok_or("Device window is closing")?;
            existing.unminimize().map_err(|e| e.to_string())?;
            existing.show().map_err(|e| e.to_string())?;
            existing.set_focus().map_err(|e| e.to_string())?;
            return Ok(label.clone());
        }
        entries.insert(session_id.clone(), DeviceWindow { label: label.clone(), device_id: device_id.clone() });
    }
    let mut url = tauri::Url::parse("http://localhost/device.html").unwrap();
    url.query_pairs_mut().append_pair("session", &session_id);
    if let Some(device) = &device_id {
        url.query_pairs_mut().append_pair("device", device);
    }
    let result =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App(format!("device.html?{}", url.query().unwrap()).into()))
            .title("Device — ALwith U")
            .inner_size(480.0, 820.0)
            .min_inner_size(360.0, 480.0)
            .visible(true)
            .build();
    let created = match result {
        Ok(created) => created,
        Err(error) => {
            app.state::<DeviceWindows>().0.lock().unwrap().remove(&session_id);
            return Err(error.to_string());
        }
    };
    let handle = app.clone();
    created.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let entry = handle.state::<DeviceWindows>().0.lock().unwrap().remove(&session_id);
            let _ = handle.emit_to(
                "main",
                "device-window-returned",
                serde_json::json!({"sessionId":session_id,"deviceId":entry.and_then(|entry| entry.device_id)}),
            );
        }
    });
    if at_cursor {
        let result = window
            .cursor_position()
            .map_err(|e| e.to_string())
            .and_then(|position| created.set_position(position).map_err(|e| e.to_string()));
        if let Err(error) = result {
            let _ = created.destroy();
            return Err(error);
        }
    }
    Ok(label)
}

#[tauri::command]
pub fn device_window_find(window: tauri::Window, session_id: String) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Device window routing belongs to main".into());
    }
    Ok(window.state::<DeviceWindows>().0.lock().unwrap().get(&session_id).map(|entry| entry.label.clone()))
}

#[tauri::command]
pub fn device_window_over_main(window: tauri::Window) -> Result<bool, String> {
    if !window.label().starts_with("device-") {
        return Err("Only device windows can dock themselves".into());
    }
    let main = window.app_handle().get_window("main").ok_or("Main window is closed")?;
    if !main.is_visible().map_err(|e| e.to_string())? || main.is_minimized().map_err(|e| e.to_string())? {
        return Ok(false);
    }
    let cursor = window.cursor_position().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let size = main.inner_size().map_err(|e| e.to_string())?;
    Ok(cursor.x >= origin.x as f64
        && cursor.y >= origin.y as f64
        && cursor.x < origin.x as f64 + size.width as f64
        && cursor.y < origin.y as f64 + size.height as f64)
}

#[tauri::command]
pub fn device_window_selection(window: tauri::Window, device_id: String) -> Result<(), String> {
    let state = window.state::<DeviceWindows>();
    let mut entries = state.0.lock().unwrap();
    let entry = entries.values_mut().find(|entry| entry.label == window.label()).ok_or("Unknown device window")?;
    entry.device_id = Some(device_id);
    Ok(())
}
