//! Thin Tauri transport over the shared Chromium bridge capability.
#[tauri3_specta::command]
pub async fn chrome_extension_installed() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| alwith_browser::chrome_extension_installed("ngkallndckjbedbjlhlleimbicdjhdeo"))
        .await
        .map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub async fn chrome_bridge_installed() -> Result<bool, String> {
    tokio::task::spawn_blocking(alwith_browser::chrome_bridge_installed).await.map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub async fn set_chrome_bridge_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri::Manager;
    #[cfg(debug_assertions)]
    let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/chrome-bridge");
    #[cfg(not(debug_assertions))]
    let source = app.path().resource_dir().map_err(|error| error.to_string())?.join("chrome-bridge");
    let _ = app.path();
    tokio::task::spawn_blocking(move || {
        if enabled {
            alwith_browser::seed_bridge(&source, &crate::runtime::sidecar_path("bun")?)?;
            if alwith_browser::install_chrome_bridge()?.is_empty() {
                return Err("No Chromium browser could be registered".into());
            }
        } else {
            alwith_browser::uninstall_chrome_bridge()?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
