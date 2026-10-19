//! Native secure storage. Legacy files are preserved until the user explicitly removes them.
use std::{collections::BTreeMap, path::PathBuf};

pub trait SecretBackend: Send + Sync {
    fn read(&self, provider: &str) -> Result<Option<String>, String>;
    fn write(&self, provider: &str, secret: &str) -> Result<(), String>;
}
struct SystemSecrets;
impl SystemSecrets {
    fn entry(provider: &str) -> Result<keyring::Entry, String> {
        // Never use keyring's mock backend on an unsupported platform.
        if !cfg!(any(target_os = "macos", target_os = "windows")) {
            return Err("voice_secure_storage_unsupported".into());
        }
        keyring::Entry::new("ai.alwith.u.voice", provider).map_err(|error| error.to_string())
    }
}
impl SecretBackend for SystemSecrets {
    fn read(&self, provider: &str) -> Result<Option<String>, String> {
        match Self::entry(provider)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    fn write(&self, provider: &str, secret: &str) -> Result<(), String> {
        Self::entry(provider)?.set_password(secret).map_err(|error| error.to_string())
    }
}

pub struct Credentials {
    backend: Box<dyn SecretBackend>,
    legacy_path: PathBuf,
}
impl Credentials {
    pub fn new(legacy_path: PathBuf) -> Self {
        Self { backend: Box::new(SystemSecrets), legacy_path }
    }
    pub fn get(&self, provider: &str) -> Result<Option<String>, String> {
        if let Some(secret) = self.backend.read(provider)? {
            // An empty secure record is a durable revocation marker. Removing the record
            // would allow a retained legacy file to silently resurrect a revoked key.
            return Ok(if secret.is_empty() { None } else { Some(secret) });
        }
        let bytes = match std::fs::read(&self.legacy_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let legacy: BTreeMap<String, String> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if let Some(secret) = legacy.get(provider) {
            validate(secret)?;
            // A failed migration is surfaced; no plaintext fallback or deletion occurs.
            self.backend.write(provider, secret)?;
            return Ok(Some(secret.clone()));
        }
        Ok(None)
    }
    pub fn set(&self, provider: &str, secret: &str) -> Result<(), String> {
        validate(secret)?;
        self.backend.write(provider, secret)
    }
    pub fn revoke(&self, provider: &str) -> Result<(), String> {
        self.backend.write(provider, "")
    }
}
fn validate(secret: &str) -> Result<(), String> {
    if secret.trim().is_empty() || secret.len() > 4096 || secret.contains(['\r', '\n']) {
        return Err("invalid_voice_credential".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    #[derive(Default)]
    struct Memory {
        values: Mutex<BTreeMap<String, String>>,
        fail: Mutex<bool>,
        fail_write: Mutex<bool>,
    }
    impl SecretBackend for Arc<Memory> {
        fn read(&self, provider: &str) -> Result<Option<String>, String> {
            if *self.fail.lock().unwrap() {
                return Err("locked".into());
            }
            Ok(self.values.lock().unwrap().get(provider).cloned())
        }
        fn write(&self, provider: &str, secret: &str) -> Result<(), String> {
            if *self.fail_write.lock().unwrap() {
                return Err("write_denied".into());
            }
            if *self.fail.lock().unwrap() {
                return Err("locked".into());
            }
            self.values.lock().unwrap().insert(provider.into(), secret.into());
            Ok(())
        }
    }
    #[test]
    fn migration_preserves_legacy_file_and_revocation_never_reimports() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.json");
        std::fs::write(&path, r#"{"vui":"old-key","doubao":"other-key"}"#).unwrap();
        let memory = Arc::new(Memory::default());
        let credentials = Credentials { backend: Box::new(memory.clone()), legacy_path: path.clone() };
        assert_eq!(credentials.get("vui").unwrap().as_deref(), Some("old-key"));
        assert!(path.exists());
        credentials.set("vui", "updated-key").unwrap();
        assert_eq!(credentials.get("vui").unwrap().as_deref(), Some("updated-key"));
        credentials.revoke("vui").unwrap();
        let restarted = Credentials { backend: Box::new(memory), legacy_path: path };
        assert_eq!(restarted.get("vui").unwrap(), None);
        assert_eq!(restarted.get("doubao").unwrap().as_deref(), Some("other-key"));
        restarted.set("vui", "new-key").unwrap();
        assert_eq!(restarted.get("vui").unwrap().as_deref(), Some("new-key"));
    }
    #[test]
    fn locked_store_and_invalid_secrets_are_errors_without_plaintext_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.json");
        std::fs::write(&path, r#"{"vui":"legacy-key"}"#).unwrap();
        let memory = Arc::new(Memory::default());
        *memory.fail.lock().unwrap() = true;
        let credentials = Credentials { backend: Box::new(memory), legacy_path: path };
        assert_eq!(credentials.get("vui").unwrap_err(), "locked");
        assert_eq!(credentials.set("vui", "key").unwrap_err(), "locked");
        assert_eq!(credentials.revoke("vui").unwrap_err(), "locked");
        assert_eq!(credentials.set("vui", " ").unwrap_err(), "invalid_voice_credential");
        assert_eq!(credentials.set("vui", "a\nb").unwrap_err(), "invalid_voice_credential");
    }
    #[test]
    fn failed_migration_does_not_return_the_plaintext_key() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.json");
        std::fs::write(&path, r#"{"vui":"legacy-key"}"#).unwrap();
        let memory = Arc::new(Memory::default());
        *memory.fail_write.lock().unwrap() = true;
        let credentials = Credentials { backend: Box::new(memory.clone()), legacy_path: path.clone() };
        assert_eq!(credentials.get("vui").unwrap_err(), "write_denied");
        assert!(memory.values.lock().unwrap().is_empty());
        assert!(path.exists());
    }
}
