//! Public Tauri transport. Window policy is supplied by the closed native capability.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::path::{Component, PathBuf};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "main" | "vibemon" | "bubble-menu-vibemon") {
        return Err("This window cannot use Vibemon".into());
    }
    Ok(())
}
async fn native(
    window: &WebviewWindow, action: &str, parent: Option<WebviewWindow>, extra: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    if action == "drag" {
        let pointer = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let parent_pointer =
            parent.as_ref().map(|p| p.hwnd().map(|v| v.0 as usize)).transpose().map_err(|e| e.to_string())?;
        return window
            .state::<crate::native::Native>()
            .call("vibemon.window", json!({"action":action,"handle":pointer,"parent":parent_pointer,"role":"pet"}))
            .await
            .map_err(|e| e.to_string());
    }
    let handle = window.clone();
    let operation = action.to_owned();
    let library = window.state::<crate::native::Native>().inner().clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || {
        let result = (|| {
            #[cfg(target_os = "macos")]
            let pointer = handle.ns_window().map_err(|e| e.to_string())? as usize;
            #[cfg(target_os = "windows")]
            let pointer = handle.hwnd().map_err(|e| e.to_string())?.0 as usize;
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let pointer = 0_usize;
            #[cfg(target_os = "macos")]
            let parent_pointer = parent.map(|p| p.ns_window().map(|v| v as usize)).transpose().map_err(|e| e.to_string())?;
            #[cfg(target_os = "windows")]
            let parent_pointer = parent.map(|p| p.hwnd().map(|v| v.0 as usize)).transpose().map_err(|e| e.to_string())?;
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let parent_pointer: Option<usize> = { let _ = parent; None };
            let mut params = json!({"action": operation, "handle": pointer, "parent": parent_pointer, "role": if handle.label() == "vibemon" { "pet" } else { "bubble" }});
            if let Some(fields) = extra.as_object() { params.as_object_mut().expect("object").extend(fields.clone()); }
            library.call_on_ui("vibemon.window", params).map_err(|e| e.to_string())
        })();
        let _ = send.send(result);
    }).map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}
fn resource_path(window: &WebviewWindow, path: &str) -> Result<PathBuf, String> {
    if !path.starts_with("vibemon/")
        || std::path::Path::new(path).components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Invalid Vibemon resource path".into());
    }
    let root = window.path().app_data_dir().map_err(|e| e.to_string())?;
    let destination = root.join(path);
    let mut current = root;
    for component in std::path::Path::new(path).components() {
        current.push(component);
        if let Ok(metadata) = std::fs::symlink_metadata(&current)
            && metadata.file_type().is_symlink()
        {
            return Err("Vibemon resources cannot follow symlinks".into());
        }
    }
    Ok(destination)
}

fn resource_exists(path: &std::path::Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod resource_tests {
    use super::resource_exists;

    #[test]
    fn resource_presence_requires_a_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("sprite-sheet.webp");
        assert!(!resource_exists(&file).unwrap());
        std::fs::write(&file, [1, 2, 3]).unwrap();
        assert!(resource_exists(&file).unwrap());
        assert!(!resource_exists(directory.path()).unwrap());
        assert!(resource_exists(&file.join("child")).is_err());
    }
}

#[tauri::command]
pub async fn vibemon_resource(
    window: WebviewWindow, action: String, path: String, bytes: Option<String>, destination: Option<String>,
) -> Result<Value, String> {
    allowed(&window)?;
    if action != "read" && action != "exists" && window.label() != "main" {
        return Err("Only an asset host can write Vibemon resources".into());
    }
    let file = resource_path(&window, &path)?;
    let target = destination.map(|p| resource_path(&window, &p)).transpose()?;
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "exists" => resource_exists(&file).map(|exists| json!(exists)),
        "read" => match std::fs::read(file) {
            Ok(bytes) => Ok(json!(STANDARD.encode(bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
            Err(e) => Err(e.to_string()),
        },
        "write" => {
            let content = STANDARD.decode(bytes.ok_or("Missing resource bytes")?).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(file.parent().ok_or("Invalid resource parent")?).map_err(|e| e.to_string())?;
            std::fs::write(file, content).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "replace" => {
            let target = target.ok_or("Missing resource destination")?;
            let backup = target.with_extension(format!("old-{}", uuid::Uuid::new_v4()));
            if target.exists() {
                std::fs::rename(&target, &backup).map_err(|e| e.to_string())?;
            }
            if let Err(error) = std::fs::rename(&file, &target) {
                if backup.exists() {
                    std::fs::rename(&backup, &target).map_err(|e| e.to_string())?;
                }
                return Err(error.to_string());
            }
            if backup.exists() {
                std::fs::remove_dir_all(backup).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "remove" => {
            if file.exists() {
                std::fs::remove_dir_all(file).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        _ => Err("Unsupported resource operation".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vibemon_download(window: WebviewWindow, url: String) -> Result<String, String> {
    allowed(&window)?;
    if window.label() != "main" {
        return Err("Only an asset host can download resources".into());
    }
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Vibemon resources require HTTPS".into());
    }
    let client =
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let mut response =
        client.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    const LIMIT: usize = 32 * 1024 * 1024;
    if response.content_length().is_some_and(|size| size > LIMIT as u64) {
        return Err("Vibemon resource exceeds 32 MiB".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("Vibemon resource exceeds 32 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn vibemon_claim(
    window: WebviewWindow, request_id: String, scope: String, session_id: String, owner: String,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Only main may execute a pet request".into());
    }
    let client = window.state::<crate::runtime::RuntimeState>().current()?;
    let states = client.run_states().await.map_err(crate::runtime::request_error)?;
    let matches: Vec<_> = states.iter().filter(|s| s.session_id == session_id).collect();
    if matches.len() != 1 || matches[0].owner_id != owner || matches[0].execution_id.is_some() {
        return Err("Vibemon execution owner changed or is read-only".into());
    }
    window
        .state::<crate::native::Native>()
        .call("vibemon.claim", json!({"scope": scope, "request_id": request_id}))
        .await
        .map_err(|e| e.to_string())?
        .as_bool()
        .ok_or("Invalid request claim response".into())
}

#[tauri::command]
pub async fn vibemon_window(window: WebviewWindow, action: String, payload: Value) -> Result<Value, String> {
    allowed(&window)?;
    let app = window.app_handle();
    match action.as_str() {
        "create-pet" | "create-bubble" => {
            if window.label() != "main" {
                return Err("Only main creates Vibemon windows".into());
            }
            if !cfg!(any(target_os = "macos", target_os = "windows")) {
                return Err("Vibemon native windows are not supported on Linux".into());
            }
            let (label, url, width, height) = match action.as_str() {
                "create-pet" => ("vibemon", "vibemon.html", 200., 200.),
                _ => ("bubble-menu-vibemon", "vibemon-bubble.html", 320., 220.),
            };
            if app.get_webview_window(label).is_some() {
                return Ok(json!(false));
            }
            let created = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
                .title("Vibémon")
                .inner_size(width, height)
                .decorations(false)
                .transparent(true)
                .visible(false)
                .focused(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .build()
                .map_err(|e| e.to_string())?;
            native(&created, "prepare", None, Value::Null).await?;
            Ok(json!(true))
        }
        "ready" => {
            app.emit_to("main", "vibemon:ready", &payload).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "monitors" => Ok(json!(
            window
                .available_monitors()
                .map_err(|e| e.to_string())?
                .iter()
                .map(|m| json!({"position":m.position(),"size":m.size(),"scaleFactor":m.scale_factor()}))
                .collect::<Vec<_>>()
        )),
        "position" => Ok(json!(window.outer_position().map_err(|e| e.to_string())?)),
        "size" => Ok(json!(window.outer_size().map_err(|e| e.to_string())?)),
        "scale" => Ok(json!(window.scale_factor().map_err(|e| e.to_string())?)),
        "resize" => {
            let size = payload["size"].as_f64().ok_or("Missing pet size")?;
            if window.label() != "vibemon" || !(32. ..=1024.).contains(&size) {
                return Err("Invalid pet size".into());
            }
            window.set_size(LogicalSize::new(size, size)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "move" => {
            if window.label() != "vibemon" {
                return Err("Only pet may move itself".into());
            }
            let x = payload["x"].as_f64().ok_or("Missing x")? as i32;
            let y = payload["y"].as_f64().ok_or("Missing y")? as i32;
            #[cfg(target_os = "windows")]
            native(&window, "move", None, json!({"x":x,"y":y})).await?;
            #[cfg(not(target_os = "windows"))]
            window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "present" | "hide" | "drag" | "sound" => {
            if !matches!(window.label(), "vibemon" | "bubble-menu-vibemon") {
                return Err("Invalid overlay caller".into());
            }
            let parent = if action == "drag" { app.get_webview_window("bubble-menu-vibemon") } else { None };
            native(&window, &action, parent, Value::Null).await?;
            if action == "drag" {
                app.emit_to("main", "vibemon:position", window.outer_position().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "bubble" => {
            if window.label() != "vibemon" {
                return Err("Only pet controls the bubble".into());
            }
            if let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") {
                if payload["visible"].as_bool().ok_or("Missing visibility")? {
                    native(&bubble, "bubble", Some(window.clone()), Value::Null).await?;
                } else {
                    native(&bubble, "hide", None, Value::Null).await?;
                }
            }
            Ok(Value::Null)
        }
        "bubble-size" => {
            if window.label() != "bubble-menu-vibemon" {
                return Err("Only bubble may size itself".into());
            }
            let width = payload["width"].as_f64().ok_or("Missing bubble width")?;
            let height = payload["height"].as_f64().ok_or("Missing bubble height")?;
            if !(160. ..=640.).contains(&width) || !(32. ..=600.).contains(&height) {
                return Err("Invalid bubble dimensions".into());
            }
            window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            if window.is_visible().map_err(|e| e.to_string())? {
                native(&window, "bubble", app.get_webview_window("vibemon"), Value::Null).await?;
            }
            Ok(Value::Null)
        }
        "bubble-close" => {
            if !matches!(window.label(), "vibemon" | "bubble-menu-vibemon" | "main") {
                return Err("Invalid bubble caller".into());
            }
            if let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") {
                native(&bubble, "hide", None, Value::Null).await?;
            }
            app.emit_to("vibemon", "vibemon:command", json!({"type":"bubble-close","petId":"","requestId":""}))
                .map_err(|e| e.to_string())?;
            app.emit_to("bubble-menu-vibemon", "vibemon:dismiss", ()).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "destroy-pet" => {
            if window.label() != "main" {
                return Err("Only main destroys pet windows".into());
            }
            if let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") {
                native(&bubble, "detach", None, Value::Null).await?;
                native(&bubble, "forget", None, Value::Null).await?;
                bubble.destroy().map_err(|e| e.to_string())?;
            }
            if let Some(pet) = app.get_webview_window("vibemon") {
                native(&pet, "forget", None, Value::Null).await?;
                pet.destroy().map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "menu" => {
            if window.label() != "vibemon" {
                return Err("Only pet has this menu".into());
            }
            let label = payload["closeLabel"]
                .as_str()
                .filter(|label| !label.trim().is_empty())
                .ok_or("Missing pet menu label")?;
            let item = tauri::menu::MenuItem::with_id(app, "vibemon-close", label, true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let menu = tauri::menu::Menu::with_items(app, &[&item]).map_err(|e| e.to_string())?;
            window.popup_menu(&menu).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("Unsupported Vibemon window action".into()),
    }
}
