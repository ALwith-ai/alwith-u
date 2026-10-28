//! U pet host. Shared packages own pet state, rendering, and assets.
mod claims;
mod download;
pub(crate) mod window;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::path::{Component, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use window::perform as window_action;

#[derive(Default)]
pub struct BubblePresentation(Mutex<BubbleState>);

#[derive(Default)]
struct BubbleState {
    requested: bool,
    ready: bool,
    focus_requested: bool,
    generation: u64,
}

impl BubbleState {
    fn visible(&self) -> bool {
        self.requested && self.ready
    }

    fn request(&mut self, visible: bool, focus: bool) {
        self.requested = visible;
        self.focus_requested = visible && (self.focus_requested || focus);
    }

    fn take_focus(&mut self) -> bool {
        if !self.visible() {
            return false;
        }
        std::mem::take(&mut self.focus_requested)
    }
}

async fn focus_requested_bubble(window: &WebviewWindow) -> Result<(), String> {
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let focus = window.state::<BubblePresentation>().0.lock().expect("bubble presentation lock").take_focus();
    if focus {
        window_action(window, "focus", None, Value::Null).await?;
    }
    Ok(())
}

/// A WebView navigation drops React without running its effect cleanups. Remove the
/// native backdrop immediately; a fresh measured backdrop is required before showing it again.
pub fn reset_bubble_on_navigation(window: WebviewWindow) {
    {
        let state = window.state::<BubblePresentation>();
        let mut state = state.0.lock().expect("bubble presentation lock");
        state.ready = false;
        state.focus_requested = false;
        state.generation += 1;
    }
    tauri::async_runtime::spawn(async move {
        let result = async {
            window_action(&window, "hide", None, Value::Null).await?;
            window_action(&window, "blur", None, json!({"radius":1,"path":null})).await?;
            Ok::<_, String>(())
        }
        .await;
        if let Err(error) = result {
            log::error!("Could not reset Vibemon bubble: {error}");
        }
    });
}

fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "main" | "vibemon" | "bubble-menu-vibemon") {
        return Err("This window cannot use Vibemon".into());
    }
    Ok(())
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
    use super::{BubbleState, resource_exists};

    #[test]
    fn bubble_requires_both_a_show_request_and_a_measured_background() {
        let mut bubble = BubbleState { requested: true, ..BubbleState::default() };
        assert!(!bubble.visible());
        bubble.ready = true;
        assert!(bubble.visible());
        // Reloading drops content readiness while preserving the user's open intent.
        bubble.ready = false;
        assert!(!bubble.visible());
        // Closing during reload must not reopen the bubble when rendering finishes.
        bubble.requested = false;
        bubble.ready = true;
        assert!(!bubble.visible());
    }

    #[test]
    fn user_focus_waits_for_readiness_and_is_consumed_once() {
        let mut bubble = BubbleState::default();
        bubble.request(true, true);
        assert!(!bubble.take_focus());
        bubble.request(true, false);
        bubble.ready = true;
        assert!(bubble.take_focus());
        assert!(!bubble.take_focus());
    }

    #[test]
    fn background_updates_and_closed_bubbles_do_not_take_focus() {
        let mut bubble = BubbleState { ready: true, ..BubbleState::default() };
        bubble.request(true, false);
        assert!(!bubble.take_focus());
        bubble.request(true, true);
        bubble.request(false, false);
        assert!(!bubble.take_focus());
        bubble.request(true, false);
        assert!(!bubble.take_focus());
    }

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

#[tauri3_specta::command]
pub async fn vibemon_resource(
    window: WebviewWindow, action: String, path: String, bytes: Option<String>, destination: Option<String>,
) -> Result<Value, String> {
    allowed(&window)?;
    if !matches!(action.as_str(), "read" | "exists" | "url") && window.label() != "main" {
        return Err("Only an asset host can write Vibemon resources".into());
    }
    let file = resource_path(&window, &path)?;
    let target = destination.map(|p| resource_path(&window, &p)).transpose()?;
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "url" => {
            if !resource_exists(&file)? {
                return Err("Vibemon resource is missing".into());
            }
            Ok(json!(file.to_str().ok_or("Invalid resource filename")?))
        }
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

#[tauri3_specta::command]
pub async fn vibemon_download(window: WebviewWindow, url: String) -> Result<String, String> {
    allowed(&window)?;
    if window.label() != "main" {
        return Err("Only an asset host can download resources".into());
    }
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("Vibemon resources require HTTPS".into());
    }
    let bytes = download::download(url).await?;
    Ok(STANDARD.encode(bytes))
}

#[tauri3_specta::command]
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
    Ok(claims::claim(&scope, &request_id))
}

#[tauri3_specta::command]
pub async fn vibemon_window(window: WebviewWindow, action: String, payload: Value) -> Result<Value, String> {
    allowed(&window)?;
    let app = window.app_handle();
    match action.as_str() {
        "create-pet" | "create-bubble" => {
            crate::window::ensure_open(app)?;
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
            if label == "bubble-menu-vibemon" {
                *window.state::<BubblePresentation>().0.lock().expect("bubble presentation lock") =
                    BubbleState::default();
            }
            let created = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
                .title("Vibémon")
                .inner_size(width, height)
                .decorations(false)
                .transparent(true)
                .visible(false)
                .focused(false)
                .accept_first_mouse(true)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .build()
                .map_err(|e| e.to_string())?;
            window_action(&created, "prepare", None, Value::Null).await?;
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
            let bottom_inset =
                payload.get("bottomInset").map_or(Ok(0.), |value| value.as_f64().ok_or("Invalid pet bottom inset"))?;
            if !(0. ..=64.).contains(&bottom_inset) {
                return Err("Invalid pet bottom inset".into());
            }
            window.set_size(LogicalSize::new(size, size + bottom_inset)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "move" => {
            if window.label() != "vibemon" {
                return Err("Only pet may move itself".into());
            }
            let x = payload["x"].as_f64().ok_or("Missing x")? as i32;
            let y = payload["y"].as_f64().ok_or("Missing y")? as i32;
            #[cfg(target_os = "windows")]
            {
                let child = match app.get_webview_window("bubble-menu-vibemon") {
                    Some(bubble) if bubble.is_visible().map_err(|e| e.to_string())? => Some(bubble),
                    _ => None,
                };
                window_action(&window, "move", child, json!({"x":x,"y":y})).await?;
            }
            #[cfg(not(target_os = "windows"))]
            window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "present" | "hide" | "drag" | "sound" | "focus" => {
            if !matches!(window.label(), "vibemon" | "bubble-menu-vibemon") {
                return Err("Invalid overlay caller".into());
            }
            if action == "hide" && window.label() == "bubble-menu-vibemon" {
                window.state::<BubblePresentation>().0.lock().expect("bubble presentation lock").request(false, false);
            }
            let parent = if action == "drag" { app.get_webview_window("bubble-menu-vibemon") } else { None };
            window_action(&window, &action, parent, Value::Null).await?;
            if window.label() == "vibemon" && matches!(action.as_str(), "present" | "hide" | "focus") {
                crate::tray::set_pet_checked(app, window.is_visible().map_err(|error| error.to_string())?);
            }
            if action == "drag" {
                app.emit_to("main", "vibemon:position", window.outer_position().map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "focus-bubble" => {
            let bubble = app.get_webview_window("bubble-menu-vibemon").ok_or("Pet bubble unavailable")?;
            {
                let state = bubble.state::<BubblePresentation>();
                let mut state = state.0.lock().expect("bubble presentation lock");
                state.focus_requested = true;
            }
            focus_requested_bubble(&bubble).await?;
            Ok(Value::Null)
        }
        "bubble" => {
            if window.label() != "vibemon" {
                return Err("Only pet controls the bubble".into());
            }
            if let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") {
                let visible = {
                    let state = window.state::<BubblePresentation>();
                    let mut state = state.0.lock().expect("bubble presentation lock");
                    let visible = payload["visible"].as_bool().ok_or("Missing visibility")?;
                    let focus = match payload.get("focus") {
                        None => false,
                        Some(Value::Bool(value)) => *value,
                        Some(_) => return Err("Invalid bubble focus intent".into()),
                    };
                    state.request(visible, focus);
                    state.visible()
                };
                let shown = bubble.is_visible().map_err(|e| e.to_string())?;
                if visible && !shown {
                    window_action(&bubble, "bubble", Some(window.clone()), Value::Null).await?;
                } else if !visible && shown {
                    window_action(&bubble, "hide", None, Value::Null).await?;
                }
                focus_requested_bubble(&bubble).await?;
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
            if window.is_visible().map_err(|e| e.to_string())? {
                window_action(
                    &window,
                    "bubble-resize",
                    app.get_webview_window("vibemon"),
                    json!({"width":width,"height":height}),
                )
                .await?;
            } else {
                window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "bubble-blur" => {
            if window.label() != "bubble-menu-vibemon" {
                return Err("Only bubble may set its background".into());
            }
            let enabled = payload["enabled"].as_bool().ok_or("Missing pet blur state")?;
            let radius = payload["radius"].as_u64().ok_or("Missing pet blur radius")?;
            if radius > 20 || enabled != payload["path"].is_array() {
                return Err("Invalid pet backdrop".into());
            }
            let generation =
                window.state::<BubblePresentation>().0.lock().expect("bubble presentation lock").generation;
            window_action(&window, "blur", None, json!({"radius":radius,"path":payload["path"]})).await?;
            let visible = {
                let state = window.state::<BubblePresentation>();
                let mut state = state.0.lock().expect("bubble presentation lock");
                if state.generation != generation {
                    return Ok(Value::Null);
                }
                state.ready = enabled;
                state.visible()
            };
            let shown = window.is_visible().map_err(|e| e.to_string())?;
            if visible && !shown {
                window_action(&window, "bubble", app.get_webview_window("vibemon"), Value::Null).await?;
            } else if !visible && shown {
                window_action(&window, "hide", None, Value::Null).await?;
            }
            focus_requested_bubble(&window).await?;
            Ok(Value::Null)
        }
        "bubble-close" => {
            if !matches!(window.label(), "vibemon" | "bubble-menu-vibemon" | "main") {
                return Err("Invalid bubble caller".into());
            }
            window.state::<BubblePresentation>().0.lock().expect("bubble presentation lock").request(false, false);
            if let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") {
                window_action(&bubble, "hide", None, Value::Null).await?;
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
                window_action(&bubble, "detach", None, Value::Null).await?;
                window_action(&bubble, "forget", None, Value::Null).await?;
                bubble.destroy().map_err(|e| e.to_string())?;
            }
            if let Some(pet) = app.get_webview_window("vibemon") {
                window_action(&pet, "forget", None, Value::Null).await?;
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
