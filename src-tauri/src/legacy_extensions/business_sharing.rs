//! A minimal, one-way projection for the installed Codex business skills.
use serde_json::{Map, Value, json};
use std::{fs, path::Path, sync::Mutex};
use tauri::Manager;

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const RELEASE_OWNER: &str = "ai.alwith.u";

fn sharing_owner(identifier: &str, debug: bool) -> String {
    if debug { format!("{identifier}.debug") } else { identifier.into() }
}

fn projection(id: &str, file: &str, value: &Value) -> Result<Value, String> {
    let fields: &[&str] = match (id, file) {
        ("bi-metrics", "data") => &["token", "device_key", "api_host", "bi_host", "api_port", "use_https"],
        ("yup-kb", "data") => &["token", "baseUrl"],
        ("yup-kb", "current") => &["fileId", "name", "fileType", "openedAt"],
        _ => return Err("Unsupported business sharing target".into()),
    };
    let mut result = Map::new();
    if !value.is_null() {
        let source = value.as_object().ok_or("Business sharing requires an object")?;
        if file == "current"
            && !source.get("fileId").is_some_and(|v| v.is_number() || v.as_str().is_some_and(|s| !s.is_empty()))
        {
            return Err("Current document requires a fileId".into());
        }
        for field in fields {
            if let Some(value) = source.get(*field) {
                if !(value.is_string() || value.is_number() || value.is_boolean() || value.is_null()) {
                    return Err("Invalid business sharing field".into());
                }
                result.insert((*field).into(), value.clone());
            }
        }
    }
    Ok(Value::Object(result))
}

fn real_directory(path: &Path, private: bool) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err("Business sharing directory must not be a symbolic link".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(if private { 0o700 } else { 0o755 });
            }
            builder.create(path).map_err(|e| format!("Create business sharing directory: {e}"))
        }
        Err(error) => Err(format!("Inspect business sharing directory: {error}")),
    }
}

fn publish(home: &Path, owner: &str, id: &str, file: &str, value: &Value) -> Result<(), String> {
    let mut value = projection(id, file, value)?;
    let encoded = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if encoded.len() > 1024 * 1024 {
        return Err("Business sharing data is too large".into());
    }
    let mut directory = home.canonicalize().map_err(|e| e.to_string())?;
    let mut components = vec![".config", "finture-bi"];
    if owner != RELEASE_OWNER {
        if owner.is_empty()
            || !owner.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
            || matches!(owner, "." | "..")
        {
            return Err("Invalid business sharing owner".into());
        }
        components.extend(["instances", owner]);
    }
    components.push(id);
    for component in components {
        directory.push(component);
        real_directory(&directory, component != ".config")?;
    }
    let path = directory.join(format!("{file}.json"));
    let existed = match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
                return Err("Business sharing target must be a bounded regular file".into());
            }
            let existing: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|_| "Business sharing target contains invalid JSON".to_string())?;
            if existing.get("_alwithU") != Some(&json!(owner)) {
                return Err(format!("共享配置冲突：{} 已有其他来源的数据，未覆盖", path.display()));
            }
            value["_alwithU"] = json!(owner);
            if existing == value {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if metadata.permissions().mode() & 0o777 == 0o600 {
                        return Ok(());
                    }
                }
                #[cfg(not(unix))]
                return Ok(());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            value["_alwithU"] = json!(owner);
            false
        }
        Err(error) => return Err(format!("Inspect business sharing target: {error}")),
    };
    // NamedTempFile is mode 0600; atomic replacement prevents readers observing partial credentials.
    let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temporary, &value).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    if existed {
        temporary.persist(&path).map_err(|e| format!("Publish business sharing data: {e}"))?;
    } else {
        temporary.persist_noclobber(&path).map_err(|e| format!("Publish business sharing data: {e}"))?;
    }
    Ok(())
}

#[tauri3_specta::command]
pub async fn legacy_share_business(
    window: tauri::Window, extension_id: String, file: String, value: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Business sharing belongs to the main window".into());
    }
    // Clearing a reader pointer remains possible after uninstall has removed the package.
    if !(file == "current" && value.is_null()) {
        super::require_installation(&window, &extension_id)?;
    }
    let _guard = WRITE_LOCK.lock().map_err(|_| "Business sharing lock poisoned")?;
    let app = window.app_handle();
    // Debug builds and alternate app identifiers must never publish into release skill configuration.
    let owner = sharing_owner(&app.config().identifier, cfg!(debug_assertions));
    publish(&app.path().home_dir().map_err(|e| e.to_string())?, &owner, &extension_id, &file, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_only_credentials_and_updates_or_revokes_them() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".config/finture-bi/bi-metrics/data.json");
        publish(
            home.path(),
            "ai.alwith.u",
            "bi-metrics",
            "data",
            &json!({"token":"first", "device_key":"key", "hiddenPanels":[1]}),
        )
        .unwrap();
        let data: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(data, json!({"token":"first", "device_key":"key", "_alwithU":"ai.alwith.u"}));
        publish(home.path(), "ai.alwith.u", "bi-metrics", "data", &json!({"token":"second"})).unwrap();
        let data: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(data, json!({"token":"second", "_alwithU":"ai.alwith.u"}));
        publish(home.path(), "ai.alwith.u", "bi-metrics", "data", &Value::Null).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
            json!({"_alwithU":"ai.alwith.u"})
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn shares_and_clears_current_document_without_overwriting_other_owners() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".config/finture-bi/yup-kb/current.json");
        publish(
            home.path(),
            "ai.alwith.u",
            "yup-kb",
            "current",
            &json!({"fileId":42, "name":"Report", "body":"secret"}),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
            json!({"_alwithU":"ai.alwith.u", "fileId":42,"name":"Report"})
        );
        publish(home.path(), "dev", "yup-kb", "current", &Value::Null).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap()["fileId"], 42);
        publish(home.path(), "ai.alwith.u", "yup-kb", "current", &Value::Null).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(),
            json!({"_alwithU":"ai.alwith.u"})
        );
        fs::write(&path, b"{\"fileId\":100}").unwrap();
        assert!(publish(home.path(), "ai.alwith.u", "yup-kb", "current", &Value::Null).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{\"fileId\":100}");
        assert!(publish(home.path(), "ai.alwith.u", "../escape", "data", &Value::Null).is_err());
    }

    #[test]
    fn development_instances_do_not_write_release_skill_configuration() {
        let home = tempfile::tempdir().unwrap();
        publish(home.path(), "ai.alwith.u", "bi-metrics", "data", &json!({"token":"release"})).unwrap();
        let path = home.path().join(".config/finture-bi/bi-metrics/data.json");
        let before = fs::read(&path).unwrap();
        publish(home.path(), "ai.alwith.u.dev", "bi-metrics", "data", &json!({"token":"dev"})).unwrap();
        assert_eq!(fs::read(&path).unwrap(), before);
        let development = home.path().join(".config/finture-bi/instances/ai.alwith.u.dev/bi-metrics/data.json");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(development).unwrap()).unwrap()["token"], "dev");
        publish(home.path(), "ai.alwith.u", "bi-metrics", "data", &json!({"token":"release-updated"})).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["token"], "release-updated");
    }

    #[test]
    fn debug_builds_with_release_identity_are_isolated() {
        let home = tempfile::tempdir().unwrap();
        let owner = sharing_owner(RELEASE_OWNER, true);
        assert_ne!(owner, RELEASE_OWNER);
        assert_eq!(sharing_owner(RELEASE_OWNER, false), RELEASE_OWNER);
        publish(home.path(), &owner, "bi-metrics", "data", &json!({"token":"debug"})).unwrap();
        assert!(!home.path().join(".config/finture-bi/bi-metrics/data.json").exists());
        let path = home.path().join(".config/finture-bi/instances/ai.alwith.u.debug/bi-metrics/data.json");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["token"], "debug");
        assert!(publish(home.path(), "../escape", "bi-metrics", "data", &Value::Null).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_linked_destination_directories_and_files() {
        let home = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(other.path(), home.path().join(".config")).unwrap();
        assert!(publish(home.path(), "ai.alwith.u", "yup-kb", "current", &Value::Null).is_err());
        assert!(fs::read_dir(other.path()).unwrap().next().is_none());
    }
}
