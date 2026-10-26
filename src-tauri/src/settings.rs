//! Tauri boundary for ordinary settings. Credentials never enter snapshots or events.
use crate::settings_store::SettingsStore;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
pub struct SharedSettings(pub Arc<Mutex<SettingsStore>>);
pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let store = SettingsStore::load(app.path().app_data_dir()?)?;
    app.state::<crate::power::PreventSleep>()
        .set_enabled(store.values.get("system.preventSleep").and_then(Value::as_bool).unwrap_or(false))?;
    app.manage(SharedSettings(Arc::new(Mutex::new(store))));
    Ok(())
}
#[tauri::command]
pub fn settings_request(
    window: tauri::Window, state: State<'_, SharedSettings>, input: Value,
) -> Result<Value, String> {
    if !matches!(window.label(), "main" | "chat" | "settings" | "gamepad" | "guide" | "vibemon" | "bubble-menu-vibemon")
    {
        return Err("Settings access denied".into());
    }
    let action = input["action"].as_str().ok_or("Missing settings action")?;
    let expected = match input.get("expectedRevision") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_u64().ok_or("Invalid settings revision")?),
    };
    let mut store = state.0.lock().map_err(|_| "Settings lock poisoned")?;
    if action != "read" {
        let changes: BTreeMap<String, Value> =
            serde_json::from_value(input["changes"].clone()).map_err(|_| "Invalid settings changes")?;
        match action {
            "update" => store.update(changes, expected)?,
            "importBrowser" => store.import_browser(changes)?,
            "saveVoice" => {
                if window.label() != "settings" {
                    return Err("Voice settings access denied".into());
                }
                let key = if input["apiKey"].is_null() {
                    None
                } else {
                    let secret = input["apiKey"].as_str().ok_or("Invalid credential")?;
                    let provider =
                        changes.get("voice.provider").and_then(Value::as_str).ok_or("Missing voice provider")?;
                    Some((format!("voice.{provider}.apiKey"), secret.to_owned()))
                };
                let provider = if key.is_some() {
                    Some(changes["voice.provider"].as_str().ok_or("Invalid voice provider")?.to_owned())
                } else {
                    None
                };
                store.save_voice(changes, key, expected.ok_or("Missing settings revision")?, || {
                    if let Some(provider) = provider {
                        crate::voice::cancel_provider(window.app_handle(), &provider)?;
                    }
                    Ok(())
                })?;
            }
            _ => return Err("Unknown settings action".into()),
        }
    }
    let (revision, values) = store.snapshot()?;
    let snapshot = json!({"revision":revision, "values":values, "browserMigrated":store.browser_migrated()});
    let prevent_sleep = values.get("system.preventSleep").and_then(Value::as_bool).unwrap_or(false);
    if action != "read" {
        window.app_handle().emit("settings:changed", &snapshot).map_err(|e| e.to_string())?;
        window.app_handle().state::<crate::power::PreventSleep>().set_enabled(prevent_sleep)?;
    }
    Ok(snapshot)
}
