// Storage stays in the application's existing JSON store. Only refresh arbitration
// is native, using the same implementation as Desktop.
#[tauri::command]
pub async fn refresh_tokens(
    state: tauri::State<'_, alwith_auth::RefreshState>,
    api_base_url: String,
    refresh_token: String,
) -> Result<alwith_auth::RefreshResult, alwith_auth::RefreshError> {
    if !matches!(
        api_base_url.as_str(),
        "https://api.alwith.ai/service" | "https://api-dev.alwith.ai/service"
    ) {
        return Err(alwith_auth::RefreshError::Network {
            message: "unsupported ALwith API origin".into(),
        });
    }
    state.refresh(api_base_url, refresh_token).await
}
