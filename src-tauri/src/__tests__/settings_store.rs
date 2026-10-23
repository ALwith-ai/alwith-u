use super::*;
use serde_json::json;
fn changes(value: Value) -> BTreeMap<String, Value> {
    serde_json::from_value(value).unwrap()
}
#[test]
fn migrates_preferences_and_voice_once_without_resurrecting_keys() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("preferences.json"), r#"{"language":"zh-CN","zoomLevel":1.2}"#).unwrap();
    std::fs::write(
        dir.path().join("voice-settings.json"),
        r#"{"enabled":false,"settings":{"provider":"doubao","doubaoResourceId":""}}"#,
    )
    .unwrap();
    std::fs::write(dir.path().join("voice-credentials.json"), r#"{"doubao":"test-secret"}"#).unwrap();
    let mut store = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(store.values["general.language"], json!("zh-CN"));
    assert_eq!(store.values["voice.enabled"], false);
    assert_eq!(store.values["voice.doubao.resourceId"], "volc.seedasr.sauc.duration");
    assert_eq!(store.secret("voice.doubao.apiKey").unwrap().as_deref(), Some("test-secret"));
    store.remove_secret("voice.doubao.apiKey").unwrap();
    let restarted = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(restarted.secret("voice.doubao.apiKey").unwrap(), None);
    assert!(!std::fs::read_to_string(dir.path().join("settings.json")).unwrap().contains("test-secret"));
}
#[test]
fn ordinary_updates_reject_secrets_unknown_keys_and_stale_forms() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    assert!(s.update(changes(json!({"voice.doubao.apiKey":"secret"})), None).is_err());
    assert!(s.update(changes(json!({"unknown.option":true})), None).is_err());
    let revision = s.snapshot().unwrap().0;
    s.update(changes(json!({"voice.enabled":false})), None).unwrap();
    assert!(s.update(changes(json!({"voice.provider":"vui"})), Some(revision)).is_err());
    assert_eq!(s.values["voice.enabled"], false);
}
#[test]
fn voice_configuration_and_secret_survive_restart_together() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    s.save_voice(
        changes(json!({"voice.provider":"doubao"})),
        Some(("voice.doubao.apiKey".into(), "test-key".into())),
        s.snapshot().unwrap().0,
        || Ok(()),
    )
    .unwrap();
    let restarted = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(restarted.values["voice.provider"], "doubao");
    assert_eq!(restarted.secret("voice.doubao.apiKey").unwrap().as_deref(), Some("test-key"));
}

#[test]
fn failed_write_keeps_active_settings_and_old_file() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    s.update(changes(json!({"voice.enabled":false})), None).unwrap();
    let old = std::fs::read(dir.path().join("settings.json")).unwrap();
    s.root = dir.path().join("blocked");
    std::fs::write(&s.root, "file").unwrap();
    assert!(s.update(changes(json!({"voice.enabled":true})), None).is_err());
    assert_eq!(s.values["voice.enabled"], false);
    assert_eq!(std::fs::read(dir.path().join("settings.json")).unwrap(), old);
}
#[test]
fn durable_commit_recovers_after_interruption_without_exposing_keys() {
    let dir = tempfile::tempdir().unwrap();
    let s = SettingsStore::load(dir.path().into()).unwrap();
    let tx = Transaction {
        settings: s.document(&changes(json!({"voice.provider":"doubao"})), 1, false),
        credentials: BTreeMap::from([("voice.doubao.apiKey".into(), "pending-key".into())]),
    };
    write_json(&dir.path().join(".settings-transaction.json"), &tx).unwrap();
    let restarted = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(restarted.secret("voice.doubao.apiKey").unwrap().as_deref(), Some("pending-key"));
    assert_eq!(restarted.values["voice.provider"], "doubao");
    assert!(!dir.path().join(".settings-transaction.json").exists());
    assert!(!serde_json::to_string(&restarted.snapshot().unwrap()).unwrap().contains("pending-key"));
}
#[test]
fn partial_commit_blocks_reads_until_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    // A directory cannot be replaced by a settings file; credentials are already committed.
    std::fs::remove_file(dir.path().join("settings.json")).unwrap();
    std::fs::create_dir(dir.path().join("settings.json")).unwrap();
    assert!(
        s.save_voice(
            changes(json!({"voice.provider":"doubao"})),
            Some(("voice.doubao.apiKey".into(), "pending".into())),
            s.snapshot().unwrap().0,
            || Ok(())
        )
        .is_err()
    );
    assert!(s.snapshot().is_err());
    assert!(s.secret("voice.doubao.apiKey").is_err());
    assert!(s.update(changes(json!({"voice.enabled":false})), None).is_err());
    std::fs::remove_dir(dir.path().join("settings.json")).unwrap();
    let restarted = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(restarted.values["voice.provider"], "doubao");
    assert_eq!(restarted.secret("voice.doubao.apiKey").unwrap().as_deref(), Some("pending"));
}
#[test]
fn browser_migration_is_one_time_and_does_not_overwrite_native_settings() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    s.update(changes(json!({"appearance.theme":"dark"})), None).unwrap();
    s.import_browser(changes(json!({"appearance.theme":"light","editor.fontSize":18}))).unwrap();
    assert_eq!(s.values["appearance.theme"], "dark");
    assert_eq!(s.values["editor.fontSize"], 18);
    s.update(changes(json!({"editor.fontSize":null})), None).unwrap();
    let mut restarted = SettingsStore::load(dir.path().into()).unwrap();
    restarted.import_browser(changes(json!({"editor.fontSize":18}))).unwrap();
    assert!(!restarted.values.contains_key("editor.fontSize"));
}
#[test]
fn corrupt_settings_are_not_overwritten_and_parse_errors_do_not_echo_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "\"private-input\"").unwrap();
    let error = SettingsStore::load(dir.path().into()).err().unwrap();
    assert!(!error.contains("private-input"));
    assert_eq!(std::fs::read_to_string(path).unwrap(), "\"private-input\"");
}
#[test]
fn validates_voice_modes_and_silence_limits_at_the_native_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsStore::load(dir.path().into()).unwrap();
    for mode in ["dictation", "send", "handsfree"] {
        s.update(changes(json!({"voice.inputMode":mode})), None).unwrap();
    }
    for mode in ["none", "scale", "auto"] {
        s.update(changes(json!({"chat.navigationSoundMode":mode})), None).unwrap();
    }
    assert!(s.update(changes(json!({"voice.doubao.resourceId":"invalid resource"})), None).is_err());
    assert!(
        s.update(
            changes(
                json!({"voice.silence":{"threshold":0,"silenceMs":1400,"initialSilenceMs":10000,"maxDurationMs":60000}})
            ),
            None
        )
        .is_err()
    );
    s.update(changes(json!({"voice.silence":{"threshold":0.015,"silenceMs":1400,"initialSilenceMs":10000,"maxDurationMs":60000}})),None).unwrap();
}
#[test]
fn rejected_voice_saves_do_not_cancel_recording() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SettingsStore::load(dir.path().into()).unwrap();
    let old = store.snapshot().unwrap().0;
    store.update(changes(json!({"voice.enabled":false})), None).unwrap();
    let mut cancelled = false;
    assert!(
        store
            .save_voice(
                changes(json!({"voice.provider":"doubao"})),
                Some(("voice.doubao.apiKey".into(), "test-key".into())),
                old,
                || {
                    cancelled = true;
                    Ok(())
                }
            )
            .is_err()
    );
    assert!(!cancelled);
    assert!(
        store
            .save_voice(changes(json!({"voice.provider":"invalid"})), None, store.snapshot().unwrap().0, || {
                cancelled = true;
                Ok(())
            })
            .is_err()
    );
    assert!(!cancelled);
    assert_eq!(store.secret("voice.doubao.apiKey").unwrap(), None);
}

#[test]
fn computer_preference_survives_restart_and_rejects_non_boolean_values() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SettingsStore::load(dir.path().into()).unwrap();
    assert!(!store.values.contains_key("computer.enabled"));
    for enabled in [true, false] {
        store.update(changes(json!({"computer.enabled": enabled})), None).unwrap();
        store = SettingsStore::load(dir.path().into()).unwrap();
        assert_eq!(store.values["computer.enabled"], enabled);
    }
    assert!(store.update(changes(json!({"computer.enabled": "true"})), None).is_err());
}
