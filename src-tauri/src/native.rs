//! Public transport only. Private implementations arrive as a verified binary.
use libloading::Library;
use serde_json::{Value, json};
use std::{
    ffi::{CStr, CString, c_char},
    path::Path,
    sync::Arc,
};
#[cfg(not(debug_assertions))]
use tauri::Manager;

type Call = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type Free = unsafe extern "C" fn(*mut c_char);
struct Functions {
    call: Call,
    free: Free,
}
pub struct Native(Arc<Functions>);

fn error(message: impl ToString) -> Value {
    json!({"kind": "network", "message": message.to_string()})
}

impl Native {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        #[cfg(debug_assertions)]
        let directory = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native");
        #[cfg(not(debug_assertions))]
        let directory = app.path().resource_dir()?.join("native");
        let _ = app;
        Self::from_path(&directory.join(libloading::library_filename("alwith_native")))
    }

    fn from_path(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        // SAFETY: load only the exact staged/bundled library, never PATH or cwd.
        // Release downloads are checksum verified. No Rust layouts cross the ABI.
        unsafe {
            let library = Library::new(path)?;
            let version = library.get::<unsafe extern "C" fn() -> u32>(b"alwith_native_abi_version\0")?;
            if version() != 1 {
                return Err("unsupported ALwith native ABI (expected 1)".into());
            }
            let call = *library.get::<Call>(b"alwith_native_call_v1\0")?;
            let free = *library.get::<Free>(b"alwith_native_free_v1\0")?;
            // Process lifetime: background executor threads must never outlive
            // their code. Intentionally don't unload this one library at exit.
            Box::leak(Box::new(library));
            Ok(Self(Arc::new(Functions { call, free })))
        }
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, Value> {
        let functions = Arc::clone(&self.0);
        let request = CString::new(json!({"method": method, "params": params}).to_string()).map_err(error)?;
        tauri::async_runtime::spawn_blocking(move || {
            // SAFETY: request is alive throughout the call; copy response bytes
            // before returning allocation ownership to the library's allocator.
            unsafe {
                let pointer = (functions.call)(request.as_ptr());
                if pointer.is_null() {
                    return Err(error("native library returned a null response"));
                }
                let response = serde_json::from_slice::<Result<Value, Value>>(CStr::from_ptr(pointer).to_bytes());
                (functions.free)(pointer);
                response.map_err(|_| error("invalid native ABI response"))?
            }
        })
        .await
        .map_err(|_| error("native worker failed"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn staged_binary_obeys_public_contract() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/native")
            .join(libloading::library_filename("alwith_native"));
        let native = Native::from_path(&path).expect("run bun run stage before Rust tests");
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
            assert_eq!(
                native
                    .call(
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
