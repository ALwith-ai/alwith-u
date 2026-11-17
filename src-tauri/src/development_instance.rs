//! Numbered development profiles and the one-time migration of the original Dev identity.
use std::path::{Path, PathBuf};

const LEGACY: &str = "ai.alwith.u.dev";
const FIRST: &str = "ai.alwith.u.dev1";

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
