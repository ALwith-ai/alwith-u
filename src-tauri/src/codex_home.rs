//! The Codex home directory the bundled Codex uses, and what earlier versions of the application left in it.
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::Manager;

/// `CODEX_HOME` when set, otherwise `~/.codex`: the same rule Codex applies.
pub fn resolve(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    match std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        Some(path) => Ok(path.into()),
        None => Ok(app.path().home_dir()?.join(".codex")),
    }
}

/// Earlier versions kept their own copy of the model catalog in `cache/alwith-u-models`. Codex keeps
/// its own (`models_cache.json`) and nothing reads that copy any more.
pub fn remove_legacy_model_cache(home: &Path) -> io::Result<()> {
    match fs::remove_dir_all(home.join("cache/alwith-u-models")) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_legacy_model_cache_is_removed() {
        let home = tempfile::tempdir().unwrap();
        let legacy = home.path().join("cache/alwith-u-models");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("key.json"), b"{}").unwrap();
        fs::create_dir_all(home.path().join("cache/codex_apps_tools")).unwrap();
        fs::write(home.path().join("models_cache.json"), b"{}").unwrap();

        remove_legacy_model_cache(home.path()).unwrap();
        assert!(!legacy.exists());
        assert!(home.path().join("cache/codex_apps_tools").is_dir());
        assert!(home.path().join("models_cache.json").is_file());
        // A second start finds nothing to remove.
        remove_legacy_model_cache(home.path()).unwrap();
    }
}
