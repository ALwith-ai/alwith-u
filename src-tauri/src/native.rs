//! Host resource selection and async dispatch through the shared public native transport.
use serde_json::{Value, json};
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[derive(Clone)]
pub struct NativeLibrary(alwith_native_client::Library);
pub struct Native {
    pub auth: NativeLibrary,
    pub installed_apps: NativeLibrary,
}
pub fn development_directory() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native"))
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}
impl Native {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        #[cfg(debug_assertions)]
        let directory = development_directory().expect("development native directory");
        #[cfg(not(debug_assertions))]
        let directory = app.path().resource_dir()?.join("native");
        let _ = app;
        alwith_native_client::configure(&directory)?;
        for module in ["mobile", "auth", "installed-apps", "voice", "fs", "gamepad", "computer", "drive", "extension"] {
            alwith_native_client::Library::module(module)?;
        }
        Ok(Self {
            auth: NativeLibrary(alwith_native_client::Library::module("auth")?),
            installed_apps: NativeLibrary(alwith_native_client::Library::module("installed-apps")?),
        })
    }
}
impl NativeLibrary {
    #[cfg(test)]
    fn from_path(path: &Path, module: &str) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self(alwith_native_client::Library::from_path(path, module)?))
    }
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, Value> {
        let library = self.0.clone();
        let method = method.to_owned();
        tauri::async_runtime::spawn_blocking(move || library.call_value(&method, params))
            .await
            .map_err(|error| json!({"kind":"network","message":format!("Native worker failed: {error}")}))?
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_a_different_modules_binary() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/native")
            .join(libloading::library_filename("alwith_native_auth"));
        assert!(NativeLibrary::from_path(&path, "installed-apps").is_err());
    }
    #[test]
    fn staged_binary_obeys_public_contract() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/native")
            .join(libloading::library_filename("alwith_native_auth"));
        let native = NativeLibrary::from_path(&path, "auth").expect("run bun run stage before Rust tests");
        tauri::async_runtime::block_on(async {
            let response = native
                .call(
                    "auth.refresh_tokens",
                    json!({
                        "api_base_url": "https://attacker.invalid", "refresh_token": "secret"
                    }),
                )
                .await
                .unwrap_err();
            assert_eq!(response["kind"], "network");
            assert!(!response.to_string().contains("secret"));
            let apps = NativeLibrary::from_path(
                &Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/native")
                    .join(libloading::library_filename("alwith_native_installed_apps")),
                "installed-apps",
            )
            .expect("stage the installed-apps module before Rust tests");
            assert_eq!(
                apps.call(
                    "installed_apps.read",
                    json!({
                        "names": ["ALwithNonexistentApp829571"], "with_icons": false
                    })
                )
                .await
                .unwrap(),
                json!([])
            );
        });
    }
}
