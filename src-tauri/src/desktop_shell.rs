#[tauri::command]
async fn has_trackpad() -> Result<bool, String> {
    atlas_tauri::availability::has_trackpad().await
}

// U owns its menu and updater, so register only the shared canvas command.
pub fn init() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    tauri::plugin::Builder::new("alwith-desktop-shell").invoke_handler(tauri::generate_handler![has_trackpad]).build()
}
