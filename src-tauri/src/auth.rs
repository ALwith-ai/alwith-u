#[derive(serde::Deserialize, serde::Serialize, specta::Type)]
pub struct RefreshedTokens {
    access_token: String,
    refresh_token: String,
}

// Transport only. The closed native library reuses Desktop's refresh implementation.
// Credentials remain in this application's existing JSON store.
#[tauri3_specta::command]
pub async fn refresh_tokens(
    state: tauri::State<'_, crate::native::Native>, api_base_url: String, refresh_token: String,
) -> Result<RefreshedTokens, serde_json::Value> {
    let value = state
        .call(
            "auth.refresh_tokens",
            serde_json::json!({
                "api_base_url": api_base_url, "refresh_token": refresh_token
            }),
        )
        .await?;
    serde_json::from_value(value)
        .map_err(|error| serde_json::json!({"kind": "invalid_response", "message": error.to_string()}))
}
