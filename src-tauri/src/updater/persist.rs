use crate::updater::state::UpdateInfo;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const STATE_FILE: &str = "updater-state.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersistedState {
    pub ready: Option<UpdateInfo>,
}

pub fn filename_from_url(url: &str) -> Option<String> {
    url.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// A missing or corrupt file means "no pending update": the file is a regenerable cache
/// written atomically by `save`, so the next check simply fetches again.
pub fn load(state_json_path: &Path) -> PersistedState {
    let Ok(text) = std::fs::read_to_string(state_json_path) else {
        return PersistedState::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(state_json_path: &Path, state: &PersistedState) -> std::io::Result<()> {
    if let Some(parent) = state_json_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = state_json_path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(state).expect("serialize PersistedState");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, state_json_path)?;
    Ok(())
}

pub fn clear(updater_dir: &Path, archive_filename: Option<&str>) -> std::io::Result<()> {
    remove_if_exists(&updater_dir.join(STATE_FILE))?;
    if let Some(name) = archive_filename {
        remove_if_exists(&updater_dir.join(name))?;
    }
    Ok(())
}

pub fn clear_or_log(updater_dir: &Path, archive_filename: Option<&str>) {
    if let Err(error) = clear(updater_dir, archive_filename) {
        log::warn!("failed to clear updater cache: {error}");
    }
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::test_support::TempDir;

    #[test]
    fn filename_from_full_url() {
        let url =
            "https://github.com/o/r/releases/download/v0.2.0/ALwith.Codex_0.2.0_aarch64.app.tar.gz";
        assert_eq!(
            filename_from_url(url).as_deref(),
            Some("ALwith.Codex_0.2.0_aarch64.app.tar.gz")
        );
    }

    #[test]
    fn filename_from_url_with_trailing_slash_or_empty() {
        assert_eq!(filename_from_url("https://x.com/path/"), None);
        assert_eq!(filename_from_url(""), None);
    }

    #[test]
    fn load_missing_or_corrupt_file_returns_default() {
        let tmp = TempDir::new();
        let path = tmp.path().join(STATE_FILE);
        assert!(load(&path).ready.is_none());
        std::fs::write(&path, "not json").unwrap();
        assert!(load(&path).ready.is_none());
    }

    #[test]
    fn save_then_load_round_trip_and_creates_parent() {
        let tmp = TempDir::new();
        let path = tmp.path().join("nested/dir").join(STATE_FILE);
        let original = PersistedState {
            ready: Some(UpdateInfo {
                version: "0.2.0".into(),
                filename: "x.tar.gz".into(),
                signature: "sig".into(),
                content_length: Some(123),
            }),
        };
        save(&path, &original).unwrap();
        assert_eq!(load(&path).ready.unwrap().version, "0.2.0");
    }

    #[test]
    fn clear_removes_state_json_and_archive_and_tolerates_absence() {
        let tmp = TempDir::new();
        let state_path = tmp.path().join(STATE_FILE);
        let archive_path = tmp.path().join("x.tar.gz");
        std::fs::write(&state_path, "{}").unwrap();
        std::fs::write(&archive_path, "data").unwrap();
        clear(tmp.path(), Some("x.tar.gz")).unwrap();
        assert!(!state_path.exists());
        assert!(!archive_path.exists());
        clear(tmp.path(), Some("nonexistent.tar.gz")).unwrap();
    }
}
