//! Backend selection is fixed for a process. Only development builds expose a restart switch.
use std::sync::OnceLock;

#[cfg(all(feature = "runtime-cef", feature = "runtime-wry", not(feature = "dev-backends")))]
compile_error!("Both backends require dev-backends");
#[cfg(all(feature = "dev-backends", not(all(debug_assertions, any(target_os = "macos", target_os = "windows")))))]
compile_error!("dev-backends is supported only by macOS and Windows debug builds");
#[cfg(not(any(feature = "runtime-cef", feature = "runtime-wry")))]
compile_error!("Select runtime-cef or runtime-wry");

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Cef,
    Wry,
}
static ACTIVE: OnceLock<Backend> = OnceLock::new();
#[cfg(all(feature = "runtime-cef", debug_assertions, target_os = "macos"))]
static DEVELOPMENT_CACHE: OnceLock<std::path::PathBuf> = OnceLock::new();
#[cfg(all(feature = "runtime-cef", debug_assertions, target_os = "macos"))]
pub fn development_cache() -> &'static std::path::Path {
    DEVELOPMENT_CACHE.get().expect("Runtime cache initialized before CEF")
}
#[cfg(feature = "dev-backends")]
static PREFERENCE: OnceLock<std::path::PathBuf> = OnceLock::new();
#[cfg(feature = "runtime-cef")]
static BROWSER_LOCALE: OnceLock<String> = OnceLock::new();
/// Match Tauri's app_data_dir before a runtime or path resolver exists.
#[cfg(feature = "runtime-cef")]
fn application_data(identifier: &str) -> Result<std::path::PathBuf, String> {
    dirs::data_dir().map(|root| root.join(identifier)).ok_or_else(|| "Cannot locate application data".into())
}
/// The language the browser words its own pages in and asks websites for.
#[cfg(feature = "runtime-cef")]
pub fn browser_locale() -> &'static str {
    BROWSER_LOCALE.get().expect("Browser locale initialized before CEF")
}
/// The interface language the user chose, as the settings document keeps it. CEF starts before
/// the settings state exists, so the one value is read from the file.
#[cfg(feature = "runtime-cef")]
fn saved_language(identifier: &str) -> Result<Option<String>, String> {
    let path = application_data(identifier)?.join("settings.json");
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let settings: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("Invalid settings: {e}"))?;
    Ok(settings.get("general.language").and_then(serde_json::Value::as_str).map(str::to_owned))
}

pub fn initialize(identifier: &str) -> Result<(), String> {
    #[cfg(all(feature = "runtime-cef", debug_assertions, target_os = "macos"))]
    {
        let home = std::env::var_os("HOME").ok_or("Cannot locate development cache")?;
        DEVELOPMENT_CACHE
            .set(std::path::PathBuf::from(home).join("Library/Caches").join(identifier).join("cef-development"))
            .map_err(|_| "Development cache already initialized")?;
    }
    #[cfg(feature = "runtime-cef")]
    BROWSER_LOCALE
        .set(crate::cef_runtime::browser_locale(
            saved_language(identifier)?.as_deref(),
            sys_locale::get_locale().as_deref(),
        ))
        .map_err(|_| "Browser locale already initialized")?;
    let backend = if cfg!(feature = "runtime-cef") { Backend::Cef } else { Backend::Wry };
    #[cfg(feature = "dev-backends")]
    let backend = {
        let path = application_data(identifier)?.join("dev-runtime.json");
        let backend = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Invalid runtime preference: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => backend,
            Err(e) => return Err(e.to_string()),
        };
        PREFERENCE.set(path).map_err(|_| "Runtime preference already initialized")?;
        backend
    };
    let _ = identifier;
    ACTIVE.set(backend).map_err(|_| "Runtime already initialized".into())
}
pub fn is_cef() -> bool {
    *ACTIVE.get().unwrap_or(&if cfg!(feature = "runtime-cef") { Backend::Cef } else { Backend::Wry }) == Backend::Cef
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    backend: Backend,
    embedded_browser: bool,
    can_switch_backend: bool,
}
#[tauri::command]
pub fn runtime_capabilities() -> Capabilities {
    Capabilities {
        backend: if is_cef() { Backend::Cef } else { Backend::Wry },
        embedded_browser: is_cef() && cfg!(feature = "experimental-cef"),
        can_switch_backend: cfg!(feature = "dev-backends"),
    }
}
#[tauri::command]
pub fn runtime_restart(webview: tauri::Webview, backend: Backend) -> Result<(), String> {
    use tauri::Manager;
    if webview.label() != "main" {
        return Err("Only the main document can change the runtime".into());
    }
    #[cfg(feature = "dev-backends")]
    {
        crate::secret_store::write_json(PREFERENCE.get().ok_or("Runtime preferences unavailable")?, &backend)?;
        webview.app_handle().request_restart();
        Ok(())
    }
    #[cfg(not(feature = "dev-backends"))]
    {
        let _ = (webview.app_handle(), backend);
        Err("Runtime switching is available only in development builds".into())
    }
}
pub fn configure(builder: tauri::Builder) -> tauri::Builder {
    #[cfg(feature = "runtime-cef")]
    if is_cef() {
        let builder = builder.runtime(crate::cef_runtime::create()).manage(crate::browser_ai::BrowserAi::default());
        #[cfg(feature = "hasgard-testing")]
        let builder = builder.plugin(tauri_plugin_hasgard::init_cef());
        return builder;
    }
    #[cfg(feature = "runtime-wry")]
    {
        let builder = builder.runtime(tauri_runtime_wry::Wry::default());
        #[cfg(feature = "hasgard-testing")]
        let builder = builder.plugin(tauri_plugin_hasgard::init());
        builder
    }
    #[cfg(not(feature = "runtime-wry"))]
    {
        unreachable!("CEF is the only compiled runtime")
    }
}

#[cfg(all(test, feature = "runtime-cef"))]
#[path = "__tests__/desktop_runtime.rs"]
mod tests;
