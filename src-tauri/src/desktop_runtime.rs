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
#[cfg(feature = "experimental-cef")]
static APPLICATION_HOSTS: OnceLock<String> = OnceLock::new();
#[cfg(feature = "experimental-cef")]
pub fn application_hosts() -> &'static str {
    APPLICATION_HOSTS.get().expect("Application hosts initialized before CEF")
}
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

pub fn initialize(config: &tauri::Config) -> Result<(), String> {
    let identifier = config.identifier.as_str();
    #[cfg(feature = "experimental-cef")]
    {
        let mut hosts = "tauri.localhost".to_owned();
        if cfg!(debug_assertions)
            && let Some(url) = &config.build.dev_url
        {
            hosts.push(',');
            hosts.push_str(url.host_str().ok_or("Development URL must have a host")?);
            if let Some(port) = url.port() {
                hosts.push_str(&format!(":{port}"));
            }
        }
        APPLICATION_HOSTS.set(hosts).map_err(|_| "Application hosts already initialized")?;
    }
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
#[cfg(feature = "runtime-cef")]
struct HasgardExecutorAssets {
    _directory: tempfile::TempDir,
}

pub fn configure(builder: tauri::Builder) -> tauri::Builder {
    #[cfg(feature = "runtime-cef")]
    if is_cef() {
        let builder = builder.runtime(crate::cef_runtime::create()).manage(crate::browser_ai::BrowserAi::default());
        let builder = builder.plugin(tauri_plugin_hasgard::init_cef_with_executor(
            tauri_plugin_hasgard::Options::default(),
            |app| {
                use tauri::Manager;
                let assets = tempfile::Builder::new().prefix("hasgard-executor-").tempdir()?;
                let script = assets.path().join("worker.mjs");
                std::fs::write(&script, tauri_plugin_hasgard::playwright::worker_source())?;
                let executable = std::env::current_exe()?;
                let program = executable
                    .parent()
                    .ok_or_else(|| std::io::Error::other("Executable has no parent"))?
                    .join(if cfg!(windows) { "bun.exe" } else { "bun" });
                let module = app.path().resource_dir()?.join("browser/node_modules/playwright-core/index.mjs");
                if !module.is_file() {
                    return Err(std::io::Error::other("Packaged Playwright module is missing").into());
                }
                let url = tauri::Url::from_file_path(module)
                    .map_err(|()| std::io::Error::other("Invalid Playwright module path"))?;
                let command = tauri_plugin_hasgard::playwright::ExecutorCommand {
                    program,
                    args: vec!["--no-install".into(), script.into_os_string(), url.as_str().into()],
                };
                app.manage(HasgardExecutorAssets { _directory: assets });
                Ok(command)
            },
        ));
        return builder;
    }
    #[cfg(feature = "runtime-wry")]
    {
        let builder = builder.runtime(tauri_runtime_wry::Wry::default());
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
