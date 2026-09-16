//! Tauri transport for the shared installed-app capability used by Desktop and U.
//! Discovery, names, icons and platform-specific launch behavior live in one Rust crate.

use alwith_installed_apps::{AppInfo, scan_named};

#[tauri::command]
pub async fn read_apps_info(names: Vec<String>, with_icons: bool) -> Vec<AppInfo> {
    tauri::async_runtime::spawn_blocking(move || scan_named(&names, with_icons))
        .await
        .unwrap_or_else(|error| {
            log::error!("read_apps_info blocking task panicked: {error}");
            Vec::new()
        })
}

#[tauri::command]
pub async fn open_path_in_app(bundle_id: String, path: String) -> Result<(), String> {
    alwith_installed_apps::open_path_in_app(&bundle_id, &path)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn finder_is_found_with_its_bundle_id() {
        let apps = scan_named(&["Finder".to_string()], false);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].bundle_id, "com.apple.finder");
        assert!(apps[0].icon.is_none());
    }

    #[test]
    fn unknown_candidates_are_skipped() {
        assert!(scan_named(&["No Such App 123".to_string()], false).is_empty());
    }
}
