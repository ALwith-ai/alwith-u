//! Login launches keep the host hidden until an authenticated, equipped pet is restored.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

pub const ARGUMENT: &str = "--vibemon-autostart";

pub struct LoginLaunch {
    started_hidden: bool,
    pending: AtomicBool,
}

impl LoginLaunch {
    pub fn new(arguments: impl IntoIterator<Item = String>) -> Self {
        let started_hidden = arguments.into_iter().any(|argument| argument == ARGUMENT);
        Self { started_hidden, pending: AtomicBool::new(started_hidden) }
    }

    pub fn started_hidden(&self) -> bool {
        self.started_hidden
    }

    pub fn pending(&self) -> bool {
        self.pending.load(Ordering::SeqCst)
    }

    pub fn finish(&self) -> bool {
        self.pending.swap(false, Ordering::SeqCst)
    }
}

#[derive(serde::Serialize, specta::Type)]
pub struct AutostartStatus {
    supported: bool,
    enabled: bool,
}

fn supported() -> bool {
    if tauri::is_dev() {
        return false;
    }
    #[cfg(target_os = "macos")]
    return std::env::current_exe().is_ok_and(|path| is_app_executable(&path));
    #[cfg(not(target_os = "macos"))]
    true
}

#[cfg(target_os = "macos")]
fn is_app_executable(path: &std::path::Path) -> bool {
    path.parent().is_some_and(|macos| {
        macos.file_name().is_some_and(|name| name == "MacOS")
            && macos.parent().is_some_and(|contents| {
                contents.file_name().is_some_and(|name| name == "Contents")
                    && contents.parent().is_some_and(|bundle| bundle.extension().is_some_and(|ext| ext == "app"))
            })
    })
}

#[tauri3_specta::command]
pub fn autostart_status(app: tauri::AppHandle) -> Result<AutostartStatus, String> {
    let supported = supported();
    let enabled = supported && app.autostart().is_enabled().map_err(|error| error.to_string())?;
    Ok(AutostartStatus { supported, enabled })
}

#[tauri3_specta::command]
pub fn autostart_set(app: tauri::AppHandle, window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("Only settings may change launch at login".into());
    }
    if !supported() {
        return Err("Launch at login requires an installed application build".into());
    }
    let launcher = app.autostart();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub fn autostart_launch(app: tauri::AppHandle) -> bool {
    app.state::<LoginLaunch>().pending()
}

#[tauri3_specta::command]
pub fn autostart_complete(app: tauri::AppHandle, window: tauri::WebviewWindow, restored: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main may complete a login launch".into());
    }
    // A manual second launch cancels the pending background exit before showing main.
    if app.state::<LoginLaunch>().finish() && !restored {
        app.exit(0);
    }
    Ok(())
}

#[cfg(test)]
#[path = "__tests__/autostart.rs"]
mod tests;
