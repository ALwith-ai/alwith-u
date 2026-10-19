//! Application settings and credential commits. No webview can read the credential map.
use crate::secret_store::{SecretStore, write_json};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub const RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
pub const PREFERENCE_KEYS: &[(&str, &str)] = &[
    ("language", "general.language"),
    ("zoomLevel", "appearance.zoomLevel"),
    ("sidebarPinned", "appearance.sidebarPinned"),
    ("chatWindowShortcut", "chat.windowShortcut"),
    ("lastProjectDirectory", "general.lastProjectDirectory"),
    ("modelSelections", "chat.modelSelections"),
    ("navigationSoundMode", "chat.navigationSoundMode"),
    ("navigationInstrument", "chat.navigationInstrument"),
    ("externalEditor", "general.externalEditor"),
];
pub const VOICE_KEYS: &[(&str, &str)] = &[
    ("provider", "voice.provider"),
    ("deviceId", "voice.deviceId"),
    ("mode", "voice.inputMode"),
    ("hotwords", "voice.hotwords"),
    ("projectHotwords", "voice.projectHotwords"),
    ("doubaoResourceId", "voice.doubao.resourceId"),
    ("smooth", "voice.smooth"),
    ("silence", "voice.silence"),
];

#[derive(Deserialize, Serialize)]
struct Transaction {
    settings: BTreeMap<String, Value>,
    credentials: BTreeMap<String, String>,
}
pub struct SettingsStore {
    root: PathBuf,
    pub values: BTreeMap<String, Value>,
    secrets: SecretStore,
    revision: u64,
    browser_migrated: bool,
    pending: bool,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| {
            format!(
                "Invalid storage JSON in {} at line {}, column {}",
                path.file_name().unwrap().to_string_lossy(),
                e.line(),
                e.column()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
impl SettingsStore {
    pub fn load(root: PathBuf) -> Result<Self, String> {
        let journal = root.join(".settings-transaction.json");
        if let Some(tx) = read_json::<Transaction>(&journal)? {
            let mut ordinary = tx.settings.clone();
            if ordinary.remove("$schemaVersion") != Some(json!(1))
                || ordinary.remove("$revision").and_then(|v| v.as_u64()).is_none()
                || ordinary.remove("$browserMigrated").and_then(|v| v.as_bool()).is_none()
            {
                return Err("Invalid settings transaction".into());
            }
            validate(&ordinary)?;
            for (key, secret) in &tx.credentials {
                validate_secret(key, secret)?;
            }
            // Redo a durable intent before any service or webview is allowed to read.
            write_json(&root.join("credentials.json"), &tx.credentials)?;
            write_json(&root.join("settings.json"), &tx.settings)?;
            std::fs::remove_file(&journal).map_err(|e| e.to_string())?;
        }
        let stored = read_json::<BTreeMap<String, Value>>(&root.join("settings.json"))?;
        let first = stored.is_none();
        let mut values = stored.unwrap_or_default();
        let (revision, browser_migrated) = if first {
            (0, false)
        } else {
            if values.remove("$schemaVersion") != Some(json!(1)) {
                return Err("Unsupported settings schema".into());
            }
            let revision = values.remove("$revision").and_then(|v| v.as_u64()).ok_or("Invalid settings revision")?;
            let browser = values
                .remove("$browserMigrated")
                .and_then(|v| v.as_bool())
                .ok_or("Invalid settings migration marker")?;
            (revision, browser)
        };
        if first {
            if let Some(old) = read_json::<BTreeMap<String, Value>>(&root.join("preferences.json"))? {
                for (source, target) in PREFERENCE_KEYS {
                    if let Some(value) = old.get(*source) {
                        values.insert((*target).into(), value.clone());
                    }
                }
            }
            if let Some(old) = read_json::<BTreeMap<String, Value>>(&root.join("voice-settings.json"))? {
                if let Some(value) = old.get("enabled") {
                    values.insert("voice.enabled".into(), value.clone());
                }
                if let Some(settings) = old.get("settings") {
                    let settings = settings.as_object().ok_or("Invalid legacy voice settings")?;
                    for (source, target) in VOICE_KEYS {
                        if let Some(value) = settings.get(*source) {
                            values.insert((*target).into(), value.clone());
                        }
                    }
                }
            }
        }
        values.retain(|_, value| !value.is_null());
        normalize(&mut values);
        validate(&values)?;
        let credentials_path = root.join("credentials.json");
        let credentials_exist = credentials_path.try_exists().map_err(|e| e.to_string())?;
        let mut secrets = SecretStore::load(credentials_path)?;
        if !credentials_exist {
            let mut imported = BTreeMap::new();
            if let Some(old) = read_json::<BTreeMap<String, String>>(&root.join("voice-credentials.json"))? {
                for (provider, secret) in old {
                    let key = format!("voice.{provider}.apiKey");
                    validate_secret(&key, &secret)?;
                    imported.insert(key, secret);
                }
            }
            secrets.replace(imported)?;
        }
        for (key, secret) in secrets.snapshot() {
            validate_secret(&key, &secret)?;
        }
        let store = Self { root, values, secrets, revision, browser_migrated, pending: false };
        if first {
            write_json(&store.root.join("settings.json"), &store.document(&store.values, revision, browser_migrated))?;
        }
        Ok(store)
    }
    fn ready(&self) -> Result<(), String> {
        if self.pending {
            Err("Settings commit interrupted; restart the application to recover".into())
        } else {
            Ok(())
        }
    }
    pub fn browser_migrated(&self) -> bool {
        self.browser_migrated
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn snapshot(&self) -> Result<(u64, BTreeMap<String, Value>), String> {
        self.ready()?;
        Ok((self.revision, self.values.clone()))
    }
    pub fn secret(&self, key: &str) -> Result<Option<String>, String> {
        self.ready()?;
        validate_secret_key(key)?;
        Ok(self.secrets.get(key).map(str::to_owned))
    }
    fn document(&self, values: &BTreeMap<String, Value>, revision: u64, browser: bool) -> BTreeMap<String, Value> {
        let mut result = values.clone();
        result.insert("$schemaVersion".into(), json!(1));
        result.insert("$revision".into(), json!(revision));
        result.insert("$browserMigrated".into(), json!(browser));
        result
    }
    fn next(&self, changes: BTreeMap<String, Value>, expected: Option<u64>) -> Result<BTreeMap<String, Value>, String> {
        self.ready()?;
        if expected.is_some_and(|r| r != self.revision) {
            return Err("Settings changed in another window; reload and retry".into());
        }
        validate(&changes)?;
        let mut values = self.values.clone();
        for (key, value) in changes {
            if value.is_null() {
                values.remove(&key);
            } else {
                values.insert(key, value);
            }
        }
        normalize(&mut values);
        Ok(values)
    }
    pub fn update(&mut self, changes: BTreeMap<String, Value>, expected: Option<u64>) -> Result<(), String> {
        let values = self.next(changes, expected)?;
        let revision = self.revision + 1;
        write_json(&self.root.join("settings.json"), &self.document(&values, revision, self.browser_migrated))?;
        self.values = values;
        self.revision = revision;
        Ok(())
    }
    pub fn import_browser(&mut self, changes: BTreeMap<String, Value>) -> Result<(), String> {
        self.ready()?;
        if self.browser_migrated {
            return Ok(());
        }
        if changes.keys().any(|key| key != "appearance.theme" && !key.starts_with("editor.")) {
            return Err("Invalid browser migration key".into());
        }
        let changes = changes.into_iter().filter(|(key, _)| !self.values.contains_key(key)).collect();
        let values = self.next(changes, None)?;
        let revision = self.revision + 1;
        write_json(&self.root.join("settings.json"), &self.document(&values, revision, true))?;
        self.values = values;
        self.revision = revision;
        self.browser_migrated = true;
        Ok(())
    }
    pub fn save_voice(
        &mut self, changes: BTreeMap<String, Value>, key: Option<(String, String)>, expected: u64,
        before_commit: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        if changes.keys().any(|k| !k.starts_with("voice.")) {
            return Err("Invalid voice settings key".into());
        }
        let values = self.next(changes, Some(expected))?;
        let mut credentials = self.secrets.snapshot();
        if let Some((key, value)) = key {
            validate_secret(&key, &value)?;
            credentials.insert(key, value);
        }
        before_commit()?;
        self.commit(values, credentials)
    }
    pub fn set_secret(&mut self, key: &str, value: &str) -> Result<(), String> {
        self.ready()?;
        validate_secret(key, value)?;
        let mut credentials = self.secrets.snapshot();
        credentials.insert(key.into(), value.into());
        self.commit(self.values.clone(), credentials)
    }
    pub fn remove_secret(&mut self, key: &str) -> Result<(), String> {
        self.ready()?;
        validate_secret_key(key)?;
        let mut credentials = self.secrets.snapshot();
        credentials.remove(key);
        self.commit(self.values.clone(), credentials)
    }
    fn commit(&mut self, values: BTreeMap<String, Value>, credentials: BTreeMap<String, String>) -> Result<(), String> {
        let revision = self.revision + 1;
        let tx = Transaction { settings: self.document(&values, revision, self.browser_migrated), credentials };
        let journal = self.root.join(".settings-transaction.json");
        self.pending = true;
        if let Err(error) = write_json(&journal, &tx) {
            self.pending = journal.try_exists().map_err(|e| e.to_string())?;
            return Err(error);
        }
        // A failure after this point blocks reads until startup replays the intent.
        write_json(&self.root.join("credentials.json"), &tx.credentials)?;
        write_json(&self.root.join("settings.json"), &tx.settings)?;
        std::fs::remove_file(journal).map_err(|e| e.to_string())?;
        self.secrets = SecretStore::load(self.root.join("credentials.json"))?;
        self.values = values;
        self.revision = revision;
        self.pending = false;
        Ok(())
    }
}
fn normalize(values: &mut BTreeMap<String, Value>) {
    if let Some(Value::String(value)) = values.get_mut("voice.doubao.resourceId") {
        *value = if value.trim().is_empty() { RESOURCE_ID.into() } else { value.trim().into() };
    }
}
fn validate_secret_key(key: &str) -> Result<(), String> {
    if matches!(key, "voice.doubao.apiKey" | "voice.vui.apiKey") {
        Ok(())
    } else {
        Err("Unknown credential key".into())
    }
}
fn validate_secret(key: &str, value: &str) -> Result<(), String> {
    validate_secret_key(key)?;
    crate::voice_credentials::validate(value)
}
fn validate(values: &BTreeMap<String, Value>) -> Result<(), String> {
    for (key, value) in values {
        let valid = match key.as_str() {
            "voice.enabled"
            | "voice.smooth"
            | "appearance.sidebarPinned"
            | "editor.fontLigatures"
            | "editor.wordWrap"
            | "editor.minimap"
            | "editor.lineNumbers"
            | "editor.renderWhitespace" => value.is_boolean(),
            "general.language"
            | "general.lastProjectDirectory"
            | "general.externalEditor"
            | "chat.windowShortcut"
            | "chat.navigationInstrument"
            | "voice.deviceId"
            | "voice.hotwords" => value.is_string(),
            "voice.doubao.resourceId" => value
                .as_str()
                .is_some_and(|v| v.trim().bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))),
            "appearance.theme" => matches!(value.as_str(), Some("light" | "dark" | "system")),
            "appearance.zoomLevel" => value.as_f64().is_some_and(|n| n > 0.0 && n <= 5.0),
            "editor.fontSize" => value.as_f64().is_some_and(|n| (8.0..=40.0).contains(&n)),
            "editor.fontFamily" => value.as_str().is_some_and(|s| s.len() <= 800),
            "editor.iconTheme" => matches!(
                value.as_str(),
                Some("vscode-icons" | "catppuccin-latte" | "catppuccin-mocha" | "material-icon-theme")
            ),
            "chat.navigationSoundMode" => matches!(value.as_str(), Some("none" | "scale" | "auto")),
            "voice.provider" => matches!(value.as_str(), Some("vui" | "doubao")),
            "voice.inputMode" => matches!(value.as_str(), Some("dictation" | "send" | "handsfree")),
            "voice.projectHotwords" => value.as_object().is_some_and(|o| o.values().all(Value::is_string)),
            "chat.modelSelections" => value.as_object().is_some_and(|o| {
                o.len() == 2 && ["main", "chat"].iter().all(|k| o.get(*k).is_some_and(|v| v.is_null() || v.is_string()))
            }),
            "voice.silence" => value.as_object().is_some_and(|o| {
                if o.len() != 4 {
                    return false;
                }
                let (Some(threshold), Some(silence), Some(initial), Some(max)) = (
                    o.get("threshold").and_then(Value::as_f64),
                    o.get("silenceMs").and_then(Value::as_f64),
                    o.get("initialSilenceMs").and_then(Value::as_f64),
                    o.get("maxDurationMs").and_then(Value::as_f64),
                ) else {
                    return false;
                };
                threshold > 0.0
                    && threshold <= 1.0
                    && (200.0..=10000.0).contains(&silence)
                    && initial >= silence
                    && max >= initial
                    && max <= 300000.0
            }),
            _ => return Err("Unknown or private settings key".into()),
        };
        if !value.is_null() && !valid {
            return Err(format!("Invalid setting: {key}"));
        }
    }
    Ok(())
}
#[cfg(test)]
#[path = "__tests__/settings_store.rs"]
mod tests;
