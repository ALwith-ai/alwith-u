//! Local plaintext credential storage. Keep secrets inside Rust; no broadcasts or backups.
use serde::Serialize;
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub struct SecretStore {
    path: PathBuf,
    values: BTreeMap<String, String>,
}
impl SecretStore {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let values = match std::fs::File::open(&path) {
            Ok(mut file) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    file.set_permissions(std::fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
                }
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
                serde_json::from_slice(&bytes).map_err(|error| {
                    // Parser diagnostics can quote input; never include secret file contents.
                    format!("Invalid credential JSON at line {}, column {}", error.line(), error.column())
                })?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self { path, values })
    }
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }
    pub fn snapshot(&self) -> BTreeMap<String, String> {
        self.values.clone()
    }
    pub fn replace(&mut self, values: BTreeMap<String, String>) -> Result<(), String> {
        self.persist(values)
    }
    pub fn set(&mut self, key: &str, secret: &str) -> Result<(), String> {
        let mut next = self.values.clone();
        next.insert(key.into(), secret.into());
        self.persist(next)
    }
    pub fn remove(&mut self, key: &str) -> Result<(), String> {
        let mut next = self.values.clone();
        next.remove(key);
        self.persist(next)
    }
    fn persist(&mut self, values: BTreeMap<String, String>) -> Result<(), String> {
        write_json(&self.path, &values)?;
        self.values = values;
        Ok(())
    }
}
#[cfg(test)]
#[path = "__tests__/secret_store.rs"]
mod tests;

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Settings path has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    #[cfg(unix)]
    std::fs::File::open(parent).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
    Ok(())
}
