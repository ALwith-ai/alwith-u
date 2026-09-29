//! Finite, digest-pinned legacy import. The remote loader is inspected, never executed.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const SOURCE: &str = "legacy:alwith-u";
const LOADER_SHA256: &str = "0c71c35baab76c40a6ba96b87116191f762d81d72950b6556822c896bb8aff8a";
const ENTRY_PREFIX: &str = "module.exports.default = function(context) { return require(\"@alwith/module-extension/legacy\").createLegacyExtension(context,";
const ENTRY_SUFFIX: &str = "); };\n";
const MAX_SOURCE: u64 = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    icon: String,
    source_sha256: String,
    patched_sha256: String,
    url: String,
}
fn profile(id: &str) -> Result<Profile, String> {
    let profiles: Vec<Profile> =
        serde_json::from_str(include_str!("../../../src/features/extensions/legacy/profiles.json"))
            .map_err(|e| format!("Invalid legacy compatibility profiles: {e}"))?;
    profiles.into_iter().find(|p| p.id == id).ok_or_else(|| format!("不支持导入此旧版扩展：{id}"))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Serialize, Clone)]
pub struct PreparedImport {
    ticket: String,
    manifest: Value,
    source: String,
    styles: String,
}
struct ImportTicket {
    window: String,
    prepared: PreparedImport,
    initial_data: Option<Value>,
    workspace_state: Option<Vec<u8>>,
}
#[derive(Default)]
pub(crate) struct LegacyImports {
    tickets: Mutex<BTreeMap<String, ImportTicket>>,
    staging: Mutex<Vec<tempfile::TempDir>>,
    registry_lock: Mutex<()>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Certificate {
    main_sha256: String,
    manifest_sha256: String,
    styles_sha256: String,
    initial_data: Option<Value>,
}
type Registry = BTreeMap<String, BTreeMap<String, Certificate>>;

fn package_revision(main: &[u8], manifest: &[u8], styles: &[u8]) -> String {
    let mut digest = Sha256::new();
    // Package protocol hashes files in lexical path order, with little-endian lengths.
    for (name, bytes) in [("main.js", main), ("manifest.json", manifest), ("styles.css", styles)] {
        digest.update((name.len() as u64).to_le_bytes());
        digest.update(name.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}

fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Read {}: {e}", path.display()))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
        return Err(format!("Expected a bounded regular file: {}", path.display()));
    }
    fs::read(path).map_err(|e| format!("Read {}: {e}", path.display()))
}
fn optional_regular(path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(_) => read_regular(path, limit).map(Some),
    }
}
fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("legacy-imports.json"))
}
fn read_registry(path: &Path) -> Result<Registry, String> {
    optional_regular(path, 32 * 1024 * 1024)?.map_or_else(
        || Ok(BTreeMap::new()),
        |bytes| serde_json::from_slice(&bytes).map_err(|e| format!("Invalid legacy import registry: {e}")),
    )
}
fn save_registry(path: &Path, registry: &Registry) -> Result<(), String> {
    let parent = path.parent().ok_or("Legacy registry has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    // NamedTempFile is private (0600 on Unix): imported credentials never enter the package.
    serde_json::to_writer(&mut file, registry).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn require_main(window: &tauri::Window) -> Result<(), String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Only the main or settings window imports legacy extensions".into());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(tag = "format", rename_all = "camelCase")]
pub enum PreparedInstall {
    Current { path: String, id: String },
    Legacy { prepared: PreparedImport },
}

fn is_legacy_manifest(manifest: &Value) -> Result<bool, String> {
    let object = manifest.as_object().ok_or("扩展清单必须是 JSON 对象")?;
    // An explicit modern declaration must never fall through to legacy conversion on error.
    if object.contains_key("manifestVersion") || object.contains_key("dependencies") {
        let current: alwith_extension::Manifest =
            serde_json::from_value(manifest.clone()).map_err(|e| format!("扩展清单无效：{e}"))?;
        if current.manifest_version != 3 {
            return Err(format!("不支持的扩展清单版本：{}", current.manifest_version));
        }
        if !current.dependencies.contains_key("@alwith/module-extension") {
            return Err("扩展清单缺少 @alwith/module-extension 版本要求".into());
        }
        return Ok(false);
    }
    if object.get("minAppVersion").and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty()) {
        return Ok(true);
    }
    Err("无法识别扩展格式：缺少 SDK 依赖或旧版 minAppVersion".into())
}

#[tauri::command]
pub async fn extension_prepare_install(
    window: tauri::Window, expected_id: Option<String>,
) -> Result<Option<PreparedInstall>, String> {
    use tauri_plugin_dialog::DialogExt;
    require_main(&window)?;
    let app = window.app_handle().clone();
    let picker_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        picker_app.dialog().file().set_title("Select an application extension directory").blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let directory = selected.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    let manifest: Value = serde_json::from_slice(&read_regular(&directory.join("manifest.json"), 128 * 1024)?)
        .map_err(|e| format!("Invalid extension manifest: {e}"))?;
    let id = manifest.get("id").and_then(Value::as_str).ok_or("Extension manifest has no id")?;
    if expected_id.as_deref().is_some_and(|expected| expected != id) {
        return Err("所选目录不是正在更新的扩展".into());
    }
    if !is_legacy_manifest(&manifest)? {
        alwith_extension::plugin::grant_install(&app, window.label(), &directory, "local")
            .map_err(|e| e.to_string())?;
        return Ok(Some(PreparedInstall::Current {
            path: directory.to_str().ok_or("Invalid extension directory path")?.into(),
            id: id.into(),
        }));
    }
    let p = profile(id)?;
    // Validate metadata now as well as on staging, before downloading anything.
    converted_manifest(&manifest, &p)?;
    let local = read_regular(&directory.join("main.js"), MAX_SOURCE)?;
    let source = if digest(&local) == p.source_sha256 {
        local
    } else {
        if digest(&local) != LOADER_SHA256 {
            return Err("旧版加载器或代码不属于已审核版本".into());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(&p.url)
            .send()
            .await
            .map_err(|e| format!("下载已审核扩展代码失败：{e}"))?
            .error_for_status()
            .map_err(|e| format!("下载已审核扩展代码失败：{e}"))?;
        if response.content_length().is_some_and(|size| size > MAX_SOURCE) {
            return Err("Legacy source is too large".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > MAX_SOURCE as usize {
                return Err("Legacy source is too large".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        bytes
    };
    if digest(&source) != p.source_sha256 {
        return Err("服务器代码与已审核版本不一致，请等待兼容配置更新；未执行远程代码".into());
    }
    let styles = optional_regular(&directory.join("styles.css"), 2 * 1024 * 1024)?.unwrap_or_default();
    let initial_data = optional_regular(&directory.join("data.json"), 8 * 1024 * 1024)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|e| format!("Invalid legacy settings: {e}")))
        .transpose()?;
    let workspace_state = if id == "yup-kb" {
        let state = optional_regular(&directory.join("workspaces.json"), 8 * 1024 * 1024)?;
        if let Some(bytes) = &state {
            let _: Value =
                serde_json::from_slice(bytes).map_err(|e| format!("Invalid legacy workspace settings: {e}"))?;
        }
        state
    } else {
        None
    };
    let prepared = PreparedImport {
        ticket: uuid::Uuid::new_v4().to_string(),
        manifest,
        source: String::from_utf8(source).map_err(|e| e.to_string())?,
        styles: String::from_utf8(styles).map_err(|e| e.to_string())?,
    };
    app.state::<LegacyImports>().tickets.lock().map_err(|_| "Legacy import lock poisoned")?.insert(
        prepared.ticket.clone(),
        ImportTicket { window: window.label().into(), prepared: prepared.clone(), initial_data, workspace_state },
    );
    Ok(Some(PreparedInstall::Legacy { prepared }))
}

fn converted_manifest(old: &Value, p: &Profile) -> Result<Value, String> {
    let name = old
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or("Legacy manifest has no name")?;
    let version = old.get("version").and_then(Value::as_str).ok_or("Legacy manifest has no version")?;
    semver::Version::parse(version).map_err(|e| format!("Invalid legacy version: {e}"))?;
    let mut manifest = json!({
        "manifestVersion": 3, "id": p.id, "name": name, "version": version,
        "icon": p.icon, "entry": "main.js", "dependencies": {"@alwith/module-extension": "^0.1.2"},
        "hosts": {"alwith-u": ">=0.1.1"}, "dataSchemaVersion": 1
    });
    for key in ["description", "author", "authorUrl"] {
        if let Some(value) = old.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()) {
            manifest[key] = Value::String(value.into());
        }
    }
    Ok(manifest)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperOptions {
    manifest: Value,
    source: String,
    styles: String,
}
fn validate_entry(main: &str, old_manifest: &Value, p: &Profile) -> Result<(), String> {
    let options = main
        .strip_prefix(ENTRY_PREFIX)
        .and_then(|text| text.strip_suffix(ENTRY_SUFFIX))
        .ok_or("Invalid legacy compatibility entry")?;
    // Parsing the complete JSON slice excludes executable suffixes, comments, or additional statements.
    let options: WrapperOptions =
        serde_json::from_str(options).map_err(|e| format!("Invalid legacy entry data: {e}"))?;
    if options.manifest != *old_manifest
        || options.styles != "styles.css"
        || digest(options.source.as_bytes()) != p.patched_sha256
    {
        return Err("Legacy entry differs from the reviewed compatibility source".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct StagedImport {
    path: String,
    id: String,
    version: String,
    source: String,
}
#[tauri::command]
pub fn legacy_stage_import(
    window: tauri::Window, ticket: String, manifest: Value, main: String,
) -> Result<StagedImport, String> {
    require_main(&window)?;
    let state = window.state::<LegacyImports>();
    let pending = state
        .tickets
        .lock()
        .map_err(|_| "Legacy import lock poisoned")?
        .remove(&ticket)
        .ok_or("Legacy import ticket expired")?;
    if pending.window != window.label() {
        return Err("Legacy import ticket belongs to another window".into());
    }
    let id = pending.prepared.manifest.get("id").and_then(Value::as_str).ok_or("Legacy manifest has no id")?;
    let p = profile(id)?;
    if manifest != converted_manifest(&pending.prepared.manifest, &p)? {
        return Err("Converted legacy manifest does not match".into());
    }
    validate_entry(&main, &pending.prepared.manifest, &p)?;
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    let staging = tempfile::tempdir().map_err(|e| e.to_string())?;
    for (name, bytes) in [
        ("manifest.json", manifest_bytes.as_slice()),
        ("main.js", main.as_bytes()),
        ("styles.css", pending.prepared.styles.as_bytes()),
    ] {
        fs::write(staging.path().join(name), bytes).map_err(|e| e.to_string())?;
    }
    if let Some(bytes) = pending.workspace_state {
        let directory = window
            .app_handle()
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("legacy-extension-files")
            .join(id);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        // Re-import must not overwrite workspace changes already made inside U.
        match options.open(directory.join("workspaces.json")) {
            Ok(mut file) => {
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let certificate = Certificate {
        main_sha256: digest(main.as_bytes()),
        manifest_sha256: digest(&manifest_bytes),
        styles_sha256: digest(pending.prepared.styles.as_bytes()),
        initial_data: pending.initial_data,
    };
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let registry_path = registry_path(window.app_handle())?;
    let mut registry = read_registry(&registry_path)?;
    let revision = package_revision(main.as_bytes(), &manifest_bytes, pending.prepared.styles.as_bytes());
    registry.entry(id.into()).or_default().entry(revision).or_insert(certificate);
    save_registry(&registry_path, &registry)?;
    alwith_extension::plugin::grant_install(window.app_handle(), window.label(), staging.path(), SOURCE)
        .map_err(|e| e.to_string())?;
    let result = StagedImport {
        path: staging.path().to_str().ok_or("Invalid legacy staging path")?.into(),
        id: id.into(),
        version: manifest["version"].as_str().ok_or("Invalid legacy version")?.into(),
        source: SOURCE.into(),
    };
    state.staging.lock().map_err(|_| "Legacy staging lock poisoned")?.push(staging);
    Ok(result)
}

pub(crate) fn require_legacy_installation(app: &tauri::AppHandle, extension_id: &str) -> Result<(), String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("extensions");
    let registry = read_registry(&registry_path(app)?)?;
    check_installation(&root, &registry, extension_id).map(|_| ())
}

fn check_installation(root: &Path, registry: &Registry, extension_id: &str) -> Result<String, String> {
    profile(extension_id)?;
    let state: Value = serde_json::from_slice(&read_regular(&root.join("state.json"), 16 * 1024 * 1024)?)
        .map_err(|e| e.to_string())?;
    let record = state
        .get("records")
        .and_then(|records| records.get(extension_id))
        .ok_or("Legacy extension is not installed")?;
    let installation = &record["installation"];
    if record["installed"] != true
        || installation["enabled"] != true
        || installation["source"] != SOURCE
        || installation["id"] != extension_id
    {
        return Err("Legacy extension is not an enabled certified import".into());
    }
    if state.get("pending").and_then(|pending| pending.get(extension_id)).is_some() {
        return Err("Legacy extension is transitioning".into());
    }
    let revision = installation["packageRevision"]
        .as_str()
        .filter(|value| value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("Invalid legacy package revision")?;
    let certificate = registry
        .get(extension_id)
        .and_then(|revisions| revisions.get(revision))
        .ok_or("Legacy import certificate missing")?;
    let package = root.join(extension_id).join("packages").join(revision);
    for (name, expected) in [
        ("main.js", &certificate.main_sha256),
        ("manifest.json", &certificate.manifest_sha256),
        ("styles.css", &certificate.styles_sha256),
    ] {
        if digest(&read_regular(&package.join(name), MAX_SOURCE * 2)?) != *expected {
            return Err("Legacy installed package differs from its native import certificate".into());
        }
    }
    Ok(revision.into())
}

#[tauri::command]
pub fn legacy_take_initial_data(window: tauri::Window, extension_id: String) -> Result<Option<Value>, String> {
    require_main(&window)?;
    require_legacy_installation(window.app_handle(), &extension_id)?;
    // Reading is repeatable so a failed context.data CAS can retry without losing settings.
    // The host only imports this when extension data is absent; normal loads use context.data.
    let registry = read_registry(&registry_path(window.app_handle())?)?;
    let root = window.app_handle().path().app_local_data_dir().map_err(|e| e.to_string())?.join("extensions");
    let revision = check_installation(&root, &registry, &extension_id)?;
    Ok(registry
        .get(&extension_id)
        .and_then(|revisions| revisions.get(&revision))
        .and_then(|entry| entry.initial_data.clone()))
}

#[tauri::command]
pub fn legacy_ack_initial_data(window: tauri::Window, extension_id: String) -> Result<(), String> {
    require_main(&window)?;
    require_legacy_installation(window.app_handle(), &extension_id)?;
    let state = window.state::<LegacyImports>();
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let path = registry_path(window.app_handle())?;
    let mut registry = read_registry(&path)?;
    let root = window.app_handle().path().app_local_data_dir().map_err(|e| e.to_string())?.join("extensions");
    let revision = check_installation(&root, &registry, &extension_id)?;
    let certificate = registry
        .get_mut(&extension_id)
        .and_then(|revisions| revisions.get_mut(&revision))
        .ok_or("Legacy import certificate missing")?;
    certificate.initial_data = None;
    save_registry(&path, &registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_format_detection_never_downgrades_current_manifests() {
        let old = json!({"id":"bi-metrics","name":"BI","version":"2.36.2","minAppVersion":"26.6.18"});
        assert!(is_legacy_manifest(&old).unwrap());
        let mut current = json!({"id":"bi-metrics","name":"BI","version":"1.0.0","dependencies":{"@alwith/module-extension":"^0.1.2"}});
        assert!(!is_legacy_manifest(&current).unwrap());
        current["manifestVersion"] = json!(3);
        assert!(!is_legacy_manifest(&current).unwrap());
        for version in [json!(2), json!(4), Value::Null, json!("3")] {
            current["manifestVersion"] = version;
            assert!(is_legacy_manifest(&current).is_err());
        }
        let mut malformed = old.clone();
        malformed["dependencies"] = Value::Null;
        assert!(is_legacy_manifest(&malformed).is_err());
        malformed = old.clone();
        malformed["manifestVersion"] = json!(3);
        assert!(is_legacy_manifest(&malformed).is_err());
        assert!(is_legacy_manifest(&json!({"id":"unknown","name":"Unknown","version":"1.0.0"})).is_err());
    }
    #[test]
    fn metadata_and_wrapper_are_native_verified() {
        let p = profile("yup-kb").unwrap();
        let old = json!({"id":"yup-kb","name":"YUP","version":"2.20.0","author":"","updateUrl":"https://example.com"});
        let manifest = converted_manifest(&old, &p).unwrap();
        assert_eq!(manifest["manifestVersion"], 3);
        assert_eq!(manifest["version"], "2.20.0");
        assert!(manifest.get("author").is_none());
        assert!(manifest.get("updateUrl").is_none());
        assert!(validate_entry("module.exports = function() {}", &old, &p).is_err());
        let forged = format!(
            "{ENTRY_PREFIX}{}{ENTRY_SUFFIX}",
            json!({"manifest":old,"source":"unreviewed()","styles":"styles.css"})
        );
        assert!(validate_entry(&forged, &old, &p).is_err());
        assert!(profile("unknown").is_err());
    }
    #[test]
    fn public_service_installs_use_certified_revisions_and_reject_tampering() {
        use alwith_extension::{Request, Service};
        let root = tempfile::tempdir().unwrap();
        let package = tempfile::tempdir().unwrap();
        let p = profile("etms-strategy-review").unwrap();
        let old = json!({"id": p.id, "name": "ETMS", "version": "0.1.0"});
        let manifest = serde_json::to_vec(&converted_manifest(&old, &p).unwrap()).unwrap();
        let main = b"module.exports.default = function() {};";
        let styles = b".legacy { display: block; }";
        for (name, bytes) in
            [("manifest.json", manifest.as_slice()), ("main.js", main.as_slice()), ("styles.css", styles.as_slice())]
        {
            fs::write(package.path().join(name), bytes).unwrap();
        }
        let revision = package_revision(main, &manifest, styles);
        let mut registry = Registry::new();
        registry.entry(p.id.clone()).or_default().insert(
            revision.clone(),
            Certificate {
                main_sha256: digest(main),
                manifest_sha256: digest(&manifest),
                styles_sha256: digest(styles),
                initial_data: Some(json!({"fixture": true})),
            },
        );
        let mut service = Service::open(root.path()).unwrap();
        let dispatch = |service: &mut Service, value: Value| {
            service.dispatch("main", serde_json::from_value::<Request>(value).unwrap()).unwrap()
        };
        dispatch(&mut service, json!({"type":"installLocal", "path":package.path(), "source":SOURCE}));
        assert_eq!(service.snapshot().installations[0].package_revision, revision);
        assert!(check_installation(root.path(), &registry, &p.id).is_err());
        dispatch(&mut service, json!({"type":"enable", "id":p.id}));
        assert_eq!(check_installation(root.path(), &registry, &p.id).unwrap(), revision);
        assert!(check_installation(root.path(), &Registry::new(), &p.id).is_err());
        // Staging a different revision cannot revoke a working installation before commit.
        registry.get_mut(&p.id).unwrap().insert(
            "a".repeat(64),
            Certificate {
                main_sha256: digest(b"future"),
                manifest_sha256: digest(&manifest),
                styles_sha256: digest(styles),
                initial_data: None,
            },
        );
        assert_eq!(check_installation(root.path(), &registry, &p.id).unwrap(), revision);
        let installed = root.path().join(&p.id).join("packages").join(&revision);
        fs::write(installed.join("main.js"), "tampered").unwrap();
        assert!(check_installation(root.path(), &registry, &p.id).is_err());
        fs::write(installed.join("main.js"), main).unwrap();
        assert!(check_installation(root.path(), &registry, &p.id).is_ok());
        dispatch(&mut service, json!({"type":"beginTransition", "id":p.id, "action":"disable"}));
        assert!(check_installation(root.path(), &registry, &p.id).is_err());
        dispatch(&mut service, json!({"type":"commitTransition", "id":p.id}));
        assert!(check_installation(root.path(), &registry, &p.id).is_err());

        let untrusted_root = tempfile::tempdir().unwrap();
        let mut untrusted = Service::open(untrusted_root.path()).unwrap();
        dispatch(&mut untrusted, json!({"type":"installLocal", "path":package.path(), "source":"local"}));
        dispatch(&mut untrusted, json!({"type":"enable", "id":p.id}));
        assert!(check_installation(untrusted_root.path(), &registry, &p.id).is_err());
    }

    #[test]
    fn wrapper_payload_is_json_data_and_rejects_executable_suffixes() {
        let mut p = profile("etms-strategy-review").unwrap();
        let old = json!({"id":p.id,"name":"ETMS","version":"0.1.0"});
        let source = "module.exports = class {};";
        p.patched_sha256 = digest(source.as_bytes());
        let payload = json!({"manifest":old,"source":source,"styles":"styles.css"});
        let entry = format!("{ENTRY_PREFIX}{payload}{ENTRY_SUFFIX}");
        assert!(validate_entry(&entry, &old, &p).is_ok());
        let injected = format!("{ENTRY_PREFIX}{payload}); evil(); ({ENTRY_SUFFIX}");
        assert!(validate_entry(&injected, &old, &p).is_err());
        let wrong_styles =
            format!("{ENTRY_PREFIX}{}{ENTRY_SUFFIX}", json!({"manifest":old,"source":source,"styles":"data.json"}));
        assert!(validate_entry(&wrong_styles, &old, &p).is_err());
    }

    #[test]
    fn imported_files_must_be_bounded_regular_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.js");
        fs::write(&path, b"reviewed").unwrap();
        assert_eq!(read_regular(&path, 8).unwrap(), b"reviewed");
        assert!(read_regular(&path, 7).is_err());
        assert!(read_regular(dir.path(), 8).is_err());
        assert_eq!(optional_regular(&dir.path().join("absent"), 8).unwrap(), None);
    }
}
