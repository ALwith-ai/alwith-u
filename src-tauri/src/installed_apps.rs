//! Tauri transport for the shared installed-app capability used by Desktop and U.
//! Discovery, names, icons and platform-specific launch behavior live in one Rust crate.

#[derive(serde::Deserialize, serde::Serialize, specta::Type)]
pub struct AppInfo {
    name: String,
    bundle_id: String,
    icon: Option<String>,
}

#[tauri3_specta::command]
pub async fn read_apps_info(
    state: tauri::State<'_, crate::native::Native>, names: Vec<String>, with_icons: bool,
) -> Result<Vec<AppInfo>, serde_json::Value> {
    let value = state
        .call(
            "installed_apps.read",
            serde_json::json!({
                "names": names, "with_icons": with_icons
            }),
        )
        .await?;
    serde_json::from_value(value)
        .map_err(|error| serde_json::json!({"kind": "invalid_response", "message": error.to_string()}))
}

#[tauri3_specta::command]
pub async fn open_path_in_app(
    state: tauri::State<'_, crate::native::Native>, bundle_id: String, path: String,
) -> Result<(), serde_json::Value> {
    state
        .call(
            "installed_apps.open_path",
            serde_json::json!({
                "bundle_id": bundle_id, "path": path
            }),
        )
        .await
        .map(|_| ())
}
