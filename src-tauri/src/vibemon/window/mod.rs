//! U-owned pet window operations. Rendering and assets stay in the shared frontend packages.
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow};

#[cfg(target_os = "macos")]
mod backdrop;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
pub(crate) use macos::{repair_bubble_position, repair_position};
#[cfg(target_os = "macos")]
pub(crate) fn forget_backdrop(handle: usize) {
    backdrop::forget(handle);
}

#[derive(Deserialize)]
pub(super) struct WindowAction {
    pub action: String,
    pub handle: usize,
    pub parent: Option<usize>,
    pub role: String,
    #[cfg(target_os = "windows")]
    pub x: Option<i32>,
    #[cfg(target_os = "windows")]
    pub y: Option<i32>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub radius: Option<u32>,
    pub path: Option<Vec<BackdropPathCommand>>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum BackdropPathCommand {
    Move {
        x: f64,
        y: f64,
    },
    Line {
        x: f64,
        y: f64,
    },
    Curve {
        #[serde(rename = "control1X")]
        control1_x: f64,
        #[serde(rename = "control1Y")]
        control1_y: f64,
        #[serde(rename = "control2X")]
        control2_x: f64,
        #[serde(rename = "control2Y")]
        control2_y: f64,
        x: f64,
        y: f64,
    },
    Close,
}

fn validate(action: &WindowAction) -> Result<(), String> {
    if matches!(action.action.as_str(), "blur" | "focus") && action.role != "bubble" {
        return Err("Only the pet bubble may focus or set its background".into());
    }
    if action.action == "blur" && action.radius.is_none() {
        return Err("Missing pet blur radius".into());
    }
    if let Some(radius) = action.radius
        && !(1..=20).contains(&radius)
    {
        return Err("Invalid pet blur radius".into());
    }
    if let Some(path) = &action.path {
        if path.is_empty() || path.len() > 128 {
            return Err("Invalid pet background outline".into());
        }
        for command in path {
            let finite = match command {
                BackdropPathCommand::Move { x, y } | BackdropPathCommand::Line { x, y } => {
                    x.is_finite() && y.is_finite()
                }
                BackdropPathCommand::Curve { control1_x, control1_y, control2_x, control2_y, x, y } => {
                    [control1_x, control1_y, control2_x, control2_y, x, y].into_iter().all(|v| v.is_finite())
                }
                BackdropPathCommand::Close => true,
            };
            if !finite {
                return Err("Pet background coordinates must be finite".into());
            }
        }
    }
    if action.width.is_some() != action.height.is_some() {
        return Err("Pet bubble dimensions must be supplied together".into());
    }
    if let Some((width, height)) = action.width.zip(action.height)
        && (!width.is_finite()
            || !height.is_finite()
            || !(160. ..=640.).contains(&width)
            || !(32. ..=600.).contains(&height))
    {
        return Err("Invalid pet bubble dimensions".into());
    }
    Ok(())
}

pub async fn perform(
    window: &WebviewWindow, action: &str, parent: Option<WebviewWindow>, extra: Value,
) -> Result<Value, String> {
    if !matches!(window.label(), "vibemon" | "bubble-menu-vibemon") {
        return Err("Invalid pet window".into());
    }
    let host = window.clone();
    let operation = action.to_owned();
    #[cfg(target_os = "windows")]
    if action == "drag" {
        // Keep both Tauri windows alive while the inactive drag loop runs off the UI thread.
        return tauri::async_runtime::spawn_blocking(move || apply(&host, &operation, parent, extra))
            .await
            .map_err(|error| error.to_string())?
            .map(|()| Value::Null);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = send.send(apply(&host, &operation, parent, extra));
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())??;
    #[cfg(target_os = "macos")]
    if action == "drag" {
        // AppKit returns after starting the drag. Keep its promise pending until release,
        // while the UI thread continues rendering frames and processing move events.
        tauri::async_runtime::spawn_blocking(macos::wait_for_drag_end).await.map_err(|error| error.to_string())?;
    }
    Ok(Value::Null)
}

fn apply(host: &WebviewWindow, operation: &str, parent: Option<WebviewWindow>, extra: Value) -> Result<(), String> {
    if matches!(operation, "present" | "focus" | "bubble") {
        crate::window::ensure_open(host.app_handle())?;
    }
    #[cfg(target_os = "macos")]
    let handle = host.ns_window().map_err(|error| error.to_string())? as usize;
    #[cfg(target_os = "macos")]
    let parent = parent.map(|p| p.ns_window().map(|v| v as usize)).transpose().map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    let handle = host.hwnd().map_err(|error| error.to_string())?.0 as usize;
    #[cfg(target_os = "windows")]
    let parent = parent.map(|p| p.hwnd().map(|v| v.0 as usize)).transpose().map_err(|error| error.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (handle, parent) = {
        let _ = parent;
        (0_usize, None::<usize>)
    };
    let mut params = match extra {
        Value::Null => serde_json::Map::new(),
        Value::Object(fields) => fields,
        _ => return Err("Invalid pet window parameters".into()),
    };
    params.insert("action".into(), json!(operation));
    params.insert("handle".into(), json!(handle));
    params.insert("parent".into(), json!(parent));
    params.insert("role".into(), json!(if host.label() == "vibemon" { "pet" } else { "bubble" }));
    let action: WindowAction = serde_json::from_value(Value::Object(params)).map_err(|error| error.to_string())?;
    validate(&action)?;
    #[cfg(target_os = "macos")]
    return macos::apply(host, action);
    #[cfg(target_os = "windows")]
    return windows::apply(action);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Vibemon windows are supported on macOS and Windows".into())
}

#[cfg(test)]
#[path = "../__tests__/window.rs"]
mod tests;
