// Transport only. The closed native library reuses Desktop's refresh implementation.
// Credentials remain in this application's existing JSON store.
#[tauri::command]
pub async fn refresh_tokens(
    state: tauri::State<'_, crate::native::Native>,
    api_base_url: String,
    refresh_token: String,
) -> Result<serde_json::Value, serde_json::Value> {
    state
        .call(
            "auth.refresh_tokens",
            serde_json::json!({
                "api_base_url": api_base_url, "refresh_token": refresh_token
            }),
        )
        .await
}
