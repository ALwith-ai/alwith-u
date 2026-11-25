//! Numbered development profiles, the one-time migration of the original Dev identity, and the
//! display a development run opens on.
use std::path::{Path, PathBuf};

const LEGACY: &str = "ai.alwith.u.dev";
const FIRST: &str = "ai.alwith.u.dev1";

/// The display named by `TAURI_HASGARD_DISPLAY`: `secondary` for the first display that is not
/// the primary one, a display's index from 0, or its name.
fn chosen(wanted: &str, primary: Option<&str>, names: &[Option<&str>]) -> Option<usize> {
    if wanted == "secondary" {
        return names.iter().position(|name| name.is_none() || *name != primary);
    }
    match wanted.parse::<usize>() {
        Ok(index) => (index < names.len()).then_some(index),
        Err(_) => names.iter().position(|name| *name == Some(wanted)),
    }
}

/// Opens the main window on the display `TAURI_HASGARD_DISPLAY` names, whatever position the last
/// run left it at, so an automated development run stays off the screen someone is working on.
/// Without the variable, or without such a display, the window stays where it was restored.
pub fn place(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let Ok(wanted) = std::env::var("TAURI_HASGARD_DISPLAY") else { return Ok(()) };
    let Some(window) = app.get_webview_window("main") else { return Ok(()) };
    let monitors = window.available_monitors().map_err(|error| error.to_string())?;
    let primary = window.primary_monitor().map_err(|error| error.to_string())?;
    let primary = primary.as_ref().and_then(|monitor| monitor.name().map(String::as_str));
    let names: Vec<_> = monitors.iter().map(|monitor| monitor.name().map(String::as_str)).collect();
    let Some(monitor) = chosen(&wanted, primary, &names).map(|index| &monitors[index]) else {
        log::warn!("No display matches TAURI_HASGARD_DISPLAY={wanted}; the window stays where it was");
        return Ok(());
    };
    let area = monitor.work_area();
    let margin = (24.0 * monitor.scale_factor()) as u32;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let room = |length: u32| length.saturating_sub(2 * margin);
    let fitted =
        tauri::PhysicalSize::new(size.width.min(room(area.size.width)), size.height.min(room(area.size.height)));
    window
        .set_position(tauri::PhysicalPosition::new(area.position.x + margin as i32, area.position.y + margin as i32))
        .map_err(|error| error.to_string())?;
    if fitted != size {
        window.set_size(fitted).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn prepare(identifier: &str) -> Result<(), String> {
    if identifier != FIRST {
        return Ok(());
    }
    let data = dirs::data_dir().ok_or("Cannot locate application data")?;
    let marker = data.join(FIRST).join(".legacy-dev-migrated");
    if marker.exists() {
        return Ok(());
    }
    let mut roots = vec![
        data.clone(),
        dirs::data_local_dir().ok_or("Cannot locate local application data")?,
        dirs::cache_dir().ok_or("Cannot locate application cache")?,
    ];
    #[cfg(target_os = "macos")]
    {
        let library = dirs::home_dir().ok_or("Cannot locate home")?.join("Library");
        roots.extend([library.join("WebKit"), library.join("HTTPStorages"), library.join("Logs")]);
    }
    roots.sort();
    roots.dedup();
    let paths: Vec<_> = roots.iter().map(|root| (root.join(LEGACY), root.join(FIRST))).collect();
    if !paths.iter().any(|(source, _)| source.exists()) {
        return Ok(());
    }
    if legacy_running() {
        return Err(
            "Quit ALwith U Dev before starting Dev 1: its existing login data must be migrated while closed".into()
        );
    }
    check_destinations(&paths)?;
    let old_index = data.join(LEGACY).join("browser-logins.json");
    let index = if old_index.exists() { old_index } else { data.join(FIRST).join("browser-logins.json") };
    crate::browser_logins::migrate_service(&index, LEGACY, FIRST)?;
    move_directories(&paths)?;
    std::fs::create_dir_all(marker.parent().unwrap()).map_err(|error| error.to_string())?;
    std::fs::write(marker, b"1\n").map_err(|error| error.to_string())
}

fn check_destinations(paths: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (source, destination) in paths {
        if source.exists() && destination.exists() {
            return Err(format!(
                "Both legacy and numbered profiles exist; refusing to overwrite {}",
                destination.display()
            ));
        }
    }
    Ok(())
}

fn move_directories(paths: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    check_destinations(paths)?;
    for (source, destination) in paths {
        if source.exists() {
            std::fs::rename(source, destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn legacy_running() -> bool {
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;
    !NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(LEGACY)).is_empty()
}

#[cfg(target_os = "windows")]
fn legacy_running() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;
    let class: Vec<u16> = format!("{LEGACY}-sic\0").encode_utf16().collect();
    unsafe { !FindWindowW(class.as_ptr(), std::ptr::null()).is_null() }
}

pub fn codex_home(identifier: &str, data: &Path) -> Option<PathBuf> {
    identifier
        .strip_prefix("ai.alwith.u.dev")
        .filter(|number| !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()) && *number != "1")
        .map(|_| data.join("codex"))
}

#[cfg(test)]
#[path = "__tests__/development_instance.rs"]
mod tests;
