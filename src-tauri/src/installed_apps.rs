//! Tauri transport for the shared installed-app capability used by Desktop and U.
//! Discovery, names, icons and platform-specific launch behavior live in one Rust crate.

#[tauri::command]
pub async fn read_apps_info(
    state: tauri::State<'_, crate::native::Native>,
    names: Vec<String>,
    with_icons: bool,
) -> Result<serde_json::Value, serde_json::Value> {
    state
        .call(
            "installed_apps.read",
            serde_json::json!({
                "names": names, "with_icons": with_icons
            }),
        )
        .await
}

#[tauri::command]
pub async fn open_path_in_app(
    state: tauri::State<'_, crate::native::Native>,
    bundle_id: String,
    path: String,
) -> Result<serde_json::Value, serde_json::Value> {
    state
        .call(
            "installed_apps.open_path",
            serde_json::json!({
                "bundle_id": bundle_id, "path": path
            }),
        )
        .await
}
