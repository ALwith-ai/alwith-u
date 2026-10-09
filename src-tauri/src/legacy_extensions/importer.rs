//! Snapshot-based local legacy import with digest-pinned business compatibility. The remote loader is inspected, never executed.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
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
pub(super) struct Profile {
    pub(super) id: String,
    icon: Option<String>,
    source_sha256: String,
    url: String,
    #[serde(default)]
    pub(super) network_hosts: Vec<String>,
    #[serde(default)]
    data_files: Vec<String>,
}
pub(super) fn profiles() -> Result<Vec<Profile>, String> {
    serde_json::from_str(include_str!("../../../src/features/extensions/legacy/profiles.json"))
        .map_err(|e| format!("Invalid legacy compatibility profiles: {e}"))
}
fn profile(id: &str) -> Result<Option<Profile>, String> {
    Ok(profiles()?.into_iter().find(|p| p.id == id))
}
fn source_requires_download(hash: &str, profile: Option<&Profile>) -> Result<bool, String> {
    match profile {
        Some(profile) if hash == profile.source_sha256 => Ok(false),
        Some(_) if hash == LOADER_SHA256 => Ok(true),
        Some(_) => Err("旧版加载器或代码不属于已审核版本".into()),
        None if hash == LOADER_SHA256 => Err("此远程加载器没有已审核的扩展配置；请选择扩展本体".into()),
        None => Ok(false),
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImport {
    ticket: String,
    manifest: Value,
    source: String,
    styles: String,
    converted_manifest: Value,
    modules: BTreeMap<String, String>,
}
struct ImportTicket {
    window: String,
    prepared: PreparedImport,
    initial_data: Option<Value>,
    files: PackageFiles,
    data_files: PackageFiles,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    file_sha256: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    data_files: PackageFiles,
}
type PackageFiles = BTreeMap<String, Vec<u8>>;
type Registry = BTreeMap<String, BTreeMap<String, Certificate>>;

fn package_revision(files: &PackageFiles) -> String {
    let mut digest = Sha256::new();
    for (name, bytes) in files {
        digest.update((name.len() as u64).to_le_bytes());
        digest.update(name.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}

fn relative_path(value: &str) -> Result<&Path, String> {
    if value.is_empty()
        || value.contains(['\\', '\0', ':', '%'])
        || Path::new(value).components().any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Legacy package requires relative regular paths".into());
    }
    Ok(Path::new(value))
}

fn snapshot_package(root: &Path) -> Result<PackageFiles, String> {
    fn collect(root: &Path, path: &Path, files: &mut PackageFiles, size: &mut usize) -> Result<(), String> {
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        if relative.components().count() > 64 {
            return Err("Legacy package is nested too deeply".into());
        }
        let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err("Legacy package cannot contain symbolic links".into());
        }
        if meta.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                collect(root, &entry.map_err(|e| e.to_string())?.path(), files, size)?;
            }
        } else {
            let name =
                relative.to_str().ok_or("Legacy resource path is not UTF-8")?.replace(std::path::MAIN_SEPARATOR, "/");
            relative_path(&name)?;
            if files.len() >= 4096 {
                return Err("Legacy package has too many files".into());
            }
            let bytes = read_regular(path, super::MAX_BYTES as u64)?;
            *size += bytes.len();
            if *size > super::MAX_BYTES {
                return Err("Legacy package exceeds 64 MiB".into());
            }
            files.insert(name, bytes);
        }
        Ok(())
    }
    let mut files = PackageFiles::new();
    collect(root, root, &mut files, &mut 0)?;
    Ok(files)
}

fn snapshot_files(root: &Path, data_names: &[String]) -> Result<(PackageFiles, PackageFiles), String> {
    let mut files = snapshot_package(root)?;
    let mut data = PackageFiles::new();
    for name in data_names.iter().map(String::as_str).chain(["data.json"]) {
        relative_path(name)?;
        if let Some(bytes) = files.remove(name) {
            data.insert(name.into(), bytes);
        }
    }
    if data.values().map(Vec::len).sum::<usize>() > MAX_SOURCE as usize {
        return Err("Legacy settings snapshots exceed 8 MiB".into());
    }
    for (name, bytes) in &data {
        if name.ends_with(".json") {
            serde_json::from_slice::<Value>(bytes).map_err(|e| format!("Invalid legacy settings {name}: {e}"))?;
        }
    }
    Ok((files, data))
}

fn migrate_named_files(root: &Path, files: &PackageFiles) -> Result<(), String> {
    let directory = super::files::open_scope(root)?;
    for (name, bytes) in files {
        let relative = super::files::scoped_path(&directory, name)?;
        if let Some(parent) = relative.parent().filter(|p| !p.as_os_str().is_empty()) {
            directory.create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
        temporary.write_all(bytes).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        // Atomic create-new preserves private edits and does not leave a partial migration.
        match temporary.persist_noclobber(root.join(relative)) {
            Ok(_) => {}
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

pub(super) fn seed_previous_root(root: &Path, selected: &Path, extension_id: &str) -> Result<(), String> {
    let Some(profile) = profile(extension_id)? else {
        return Ok(());
    };
    if profile.data_files.is_empty() {
        return Ok(());
    }
    let source = super::files::open_scope(root)?;
    let destination = super::files::open_scope(selected)?;
    // The canonical root is outside the active nested private namespace. Keeping
    // this host marker there prevents ordinary extension writes from clearing it.
    let marker = root.join(".legacy-layout-seeded.json");
    const COMPLETED: &[u8] = br#"{"version":1}"#;
    if let Some(bytes) = optional_regular(&marker, 128)? {
        if bytes != COMPLETED {
            return Err("Invalid legacy layout migration marker".into());
        }
        return Ok(());
    }
    let mut files = PackageFiles::new();
    for name in profile.data_files {
        let target = super::files::scoped_path(&destination, &name)?;
        if destination.try_exists(target).map_err(|e| e.to_string())? {
            continue;
        }
        let path = super::files::scoped_path(&source, &name)?;
        if let Some(bytes) = optional_regular(&root.join(path), MAX_SOURCE)? {
            files.insert(name, bytes);
        }
    }
    migrate_named_files(selected, &files)?;
    #[cfg(unix)]
    fs::File::open(selected).and_then(|directory| directory.sync_all()).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    temporary.write_all(COMPLETED).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    match temporary.persist_noclobber(&marker) {
        Ok(_) => {}
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            if read_regular(&marker, 128)? != COMPLETED {
                return Err("Invalid legacy layout migration marker".into());
            }
        }
        Err(error) => return Err(error.to_string()),
    }
    #[cfg(unix)]
    fs::File::open(root).and_then(|directory| directory.sync_all()).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Read {}: {e}", path.display()))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
        return Err(format!("Expected a bounded regular file: {}", path.display()));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Legacy file exceeded size limit while reading".into());
    }
    Ok(bytes)
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
    let bytes = serde_json::to_vec(registry).map_err(|e| e.to_string())?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Legacy import registry exceeds 32 MiB; existing registry was preserved".into());
    }
    let parent = path.parent().ok_or("Legacy registry has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    // NamedTempFile is private (0600 on Unix): imported credentials never enter the package.
    file.write_all(&bytes).map_err(|e| e.to_string())?;
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
    Current { path: String, id: String, version: String, digest: String },
    Legacy { prepared: PreparedImport },
}

impl PreparedInstall {
    pub(crate) fn id(&self) -> Result<&str, String> {
        match self {
            Self::Current { id, .. } => Ok(id),
            Self::Legacy { prepared } => prepared.manifest["id"].as_str().ok_or_else(|| "Missing prepared ID".into()),
        }
    }
}

fn is_legacy_manifest(manifest: &Value) -> Result<bool, String> {
    let object = manifest.as_object().ok_or("扩展清单必须是 JSON 对象")?;
    // An explicit modern declaration must never fall through to legacy conversion on error.
    if object.get("dependencies").is_some_and(|value| !value.is_object()) {
        return Err("扩展 dependencies 必须是 JSON 对象".into());
    }
    if object.contains_key("manifestVersion")
        || object
            .get("dependencies")
            .and_then(Value::as_object)
            .is_some_and(|dependencies| dependencies.contains_key("@alwith/module-extension"))
    {
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
    let directory = selected.into_path().map_err(|e| e.to_string())?;
    prepare_install_from_directory(&window, &directory, expected_id.as_deref()).await.map(Some)
}

/// The caller owns native authorization: a folder picker or an authenticated local CLI request.
pub(crate) async fn prepare_install_from_directory(
    window: &tauri::Window, directory: &Path, expected_id: Option<&str>,
) -> Result<PreparedInstall, String> {
    require_main(window)?;
    let app = window.app_handle().clone();
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    let manifest: Value = serde_json::from_slice(&read_regular(&directory.join("manifest.json"), 128 * 1024)?)
        .map_err(|e| format!("Invalid extension manifest: {e}"))?;
    let id = manifest.get("id").and_then(Value::as_str).ok_or("Extension manifest has no id")?;
    if expected_id.is_some_and(|expected| expected != id) {
        return Err("所选目录不是正在更新的扩展".into());
    }
    if !is_legacy_manifest(&manifest)? {
        // Pin the same bytes the installer will consume; changes after preparation fail the digest check.
        let package_files = snapshot_package(&directory)?;
        let snapshot_manifest: Value =
            serde_json::from_slice(package_files.get("manifest.json").ok_or("Manifest disappeared")?)
                .map_err(|e| e.to_string())?;
        if snapshot_manifest != manifest {
            return Err("Extension manifest changed during import".into());
        }
        alwith_extension::plugin::grant_install(&app, window.label(), &directory, "local")
            .map_err(|e| e.to_string())?;
        return Ok(PreparedInstall::Current {
            path: directory.to_str().ok_or("Invalid extension directory path")?.into(),
            id: id.into(),
            version: manifest["version"].as_str().ok_or("Extension version missing")?.into(),
            digest: package_revision(&package_files),
        });
    }
    let p = profile(id)?;
    // Validate metadata now as well as on staging, before downloading anything.
    let converted_manifest = converted_manifest(&manifest, p.as_ref())?;
    let (mut files, mut data_files) = snapshot_files(&directory, p.as_ref().map_or(&[], |p| p.data_files.as_slice()))?;
    let snapshot_manifest: Value =
        serde_json::from_slice(files.get("manifest.json").ok_or("Legacy manifest disappeared")?)
            .map_err(|e| e.to_string())?;
    if snapshot_manifest != manifest {
        return Err("Legacy manifest changed during import".into());
    }
    let local = files.remove("main.js").ok_or("Legacy main.js missing")?;
    if local.len() as u64 > MAX_SOURCE {
        return Err("Legacy source is too large".into());
    }
    let source = if !source_requires_download(&digest(&local), p.as_ref())? {
        local
    } else {
        let p = p.as_ref().ok_or("Missing reviewed profile")?;
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
    if p.as_ref().is_some_and(|p| digest(&source) != p.source_sha256) {
        return Err("服务器代码与已审核版本不一致，请等待兼容配置更新；未执行远程代码".into());
    }
    let styles = files.remove("styles.css").unwrap_or_default();
    let initial_data = data_files
        .remove("data.json")
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|e| format!("Invalid legacy settings: {e}")))
        .transpose()?;
    let modules = files
        .iter()
        .filter(|(name, _)| name.ends_with(".js") || name.ends_with(".json"))
        .map(|(name, bytes)| {
            String::from_utf8(bytes.clone()).map(|text| (name.clone(), text)).map_err(|e| e.to_string())
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    files.remove("manifest.json");
    let prepared = PreparedImport {
        ticket: uuid::Uuid::new_v4().to_string(),
        converted_manifest,
        modules,
        manifest,
        source: String::from_utf8(source).map_err(|e| e.to_string())?,
        styles: String::from_utf8(styles).map_err(|e| e.to_string())?,
    };
    app.state::<LegacyImports>().tickets.lock().map_err(|_| "Legacy import lock poisoned")?.insert(
        prepared.ticket.clone(),
        ImportTicket { window: window.label().into(), prepared: prepared.clone(), initial_data, files, data_files },
    );
    Ok(PreparedInstall::Legacy { prepared })
}

fn converted_manifest(old: &Value, p: Option<&Profile>) -> Result<Value, String> {
    let name = old
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or("Legacy manifest has no name")?;
    let version = old.get("version").and_then(Value::as_str).ok_or("Legacy manifest has no version")?;
    semver::Version::parse(version).map_err(|e| format!("Invalid legacy version: {e}"))?;
    let id = old
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| {
            id.len() <= 64
                && id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
                && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        .ok_or("Invalid legacy extension id")?;
    let mut manifest = json!({
        "manifestVersion": 3, "id": id, "name": name, "version": version,
        "entry": "main.js", "dependencies": {"@alwith/module-extension": "^0.1.6"},
        "hosts": {"alwith-u": ">=0.1.1"}, "dataSchemaVersion": 1
    });
    if let Some(icon) = p.and_then(|p| p.icon.as_deref()) {
        manifest["icon"] = json!(icon);
    } else if let Some(icon) = old.get("icon").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
        let candidate = if icon.contains(':') { icon.to_owned() } else { format!("lucide:{icon}") };
        manifest["icon"] = json!(candidate);
        let typed: alwith_extension::Manifest = serde_json::from_value(manifest.clone()).map_err(|e| e.to_string())?;
        // Old Obsidian icon names and local icon paths are optional metadata;
        // keep only forms the public package metadata model can represent.
        if alwith_extension::validate_manifest(&typed).is_err() {
            manifest.as_object_mut().ok_or("Converted manifest is not an object")?.remove("icon");
        }
    }
    for key in ["description", "author", "authorUrl"] {
        if let Some(value) = old.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()) {
            manifest[key] = Value::String(value.into());
        }
    }
    let typed: alwith_extension::Manifest =
        serde_json::from_value(manifest.clone()).map_err(|e| format!("Invalid converted manifest: {e}"))?;
    alwith_extension::validate_manifest(&typed).map_err(|e| format!("Invalid converted manifest: {e}"))?;
    Ok(manifest)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WrapperOptions {
    manifest: Value,
    source: String,
    styles: String,
    #[serde(default)]
    modules: BTreeMap<String, String>,
}
fn validate_entry(
    main: &str, old_manifest: &Value, expected_source_hash: &str, modules: &BTreeMap<String, String>,
) -> Result<(), String> {
    let options = main
        .strip_prefix(ENTRY_PREFIX)
        .and_then(|text| text.strip_suffix(ENTRY_SUFFIX))
        .ok_or("Invalid legacy compatibility entry")?;
    // Parsing the complete JSON slice excludes executable suffixes, comments, or additional statements.
    let options: WrapperOptions =
        serde_json::from_str(options).map_err(|e| format!("Invalid legacy entry data: {e}"))?;
    if options.manifest != *old_manifest
        || options.styles != "styles.css"
        || digest(options.source.as_bytes()) != expected_source_hash
        || options.modules != *modules
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
    digest: String,
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
    if manifest != pending.prepared.converted_manifest {
        return Err("Converted legacy manifest does not match".into());
    }
    let expected_source = digest(pending.prepared.source.as_bytes());
    validate_entry(&main, &pending.prepared.manifest, &expected_source, &pending.prepared.modules)?;
    let manifest_bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    let staging = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut files = pending.files;
    files.insert("manifest.json".into(), manifest_bytes.clone());
    files.insert("main.js".into(), main.as_bytes().to_vec());
    files.insert("styles.css".into(), pending.prepared.styles.as_bytes().to_vec());
    if files.values().map(Vec::len).sum::<usize>() > super::MAX_BYTES || files.len() > 4096 {
        return Err("Converted legacy package exceeds package size or file count limits".into());
    }
    for (name, bytes) in &files {
        let target = staging.path().join(relative_path(name)?);
        fs::create_dir_all(target.parent().ok_or("Missing staged file parent")?).map_err(|e| e.to_string())?;
        fs::write(target, bytes).map_err(|e| e.to_string())?;
    }
    let certificate = Certificate {
        main_sha256: digest(main.as_bytes()),
        manifest_sha256: digest(&manifest_bytes),
        styles_sha256: digest(pending.prepared.styles.as_bytes()),
        initial_data: pending.initial_data,
        file_sha256: files.iter().map(|(name, bytes)| (name.clone(), digest(bytes))).collect(),
        data_files: pending.data_files,
    };
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let registry_path = registry_path(window.app_handle())?;
    let mut registry = read_registry(&registry_path)?;
    let revision = package_revision(&files);
    registry.entry(id.into()).or_default().entry(revision.clone()).or_insert(certificate);
    save_registry(&registry_path, &registry)?;
    alwith_extension::plugin::grant_install(window.app_handle(), window.label(), staging.path(), SOURCE)
        .map_err(|e| e.to_string())?;
    let result = StagedImport {
        path: staging.path().to_str().ok_or("Invalid legacy staging path")?.into(),
        id: id.into(),
        version: manifest["version"].as_str().ok_or("Invalid legacy version")?.into(),
        source: SOURCE.into(),
        digest: revision,
    };
    state.staging.lock().map_err(|_| "Legacy staging lock poisoned")?.push(staging);
    Ok(result)
}

pub(crate) fn require_legacy_installation(app: &tauri::AppHandle, extension_id: &str) -> Result<(), String> {
    installed_files(app, extension_id).map(|_| ())
}

fn check_installation(
    installation: &alwith_extension::Installation, files: &PackageFiles, registry: &Registry,
) -> Result<String, String> {
    let certificate = registry
        .get(&installation.id)
        .and_then(|revisions| revisions.get(&installation.package_revision))
        .ok_or("Legacy import certificate missing")?;
    let expected = if certificate.file_sha256.is_empty() {
        BTreeMap::from([
            ("main.js".into(), certificate.main_sha256.clone()),
            ("manifest.json".into(), certificate.manifest_sha256.clone()),
            ("styles.css".into(), certificate.styles_sha256.clone()),
        ])
    } else {
        certificate.file_sha256.clone()
    };
    if files.len() != expected.len()
        || expected.iter().any(|(name, hash)| files.get(name).is_none_or(|bytes| digest(bytes) != *hash))
    {
        return Err("Legacy installed package differs from its native import certificate".into());
    }
    Ok(installation.package_revision.clone())
}

fn installed_files(app: &tauri::AppHandle, extension_id: &str) -> Result<(String, PackageFiles), String> {
    let (identity, files) =
        alwith_extension::plugin::installed_package(app, extension_id, SOURCE).map_err(|e| e.to_string())?;
    let registry = read_registry(&registry_path(app)?)?;
    let revision = check_installation(&identity, &files, &registry)?;
    Ok((revision, files))
}

pub(super) fn package_files(app: &tauri::AppHandle, extension_id: &str) -> Result<PackageFiles, String> {
    Ok(installed_files(app, extension_id)?.1)
}

pub(super) fn migrate_initial_files(app: &tauri::AppHandle, extension_id: &str, root: &Path) -> Result<(), String> {
    let (revision, _) = installed_files(app, extension_id)?;
    let state = app.state::<LegacyImports>();
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let path = registry_path(app)?;
    let mut registry = read_registry(&path)?;
    let certificate =
        registry.get_mut(extension_id).and_then(|r| r.get_mut(&revision)).ok_or("Legacy import certificate missing")?;
    if certificate.data_files.is_empty() {
        return Ok(());
    }
    migrate_named_files(root, &certificate.data_files)?;
    // Successful activation consumes the pending snapshot; later removals stay removed.
    certificate.data_files.clear();
    save_registry(&path, &registry)
}

#[tauri::command]
pub fn legacy_take_initial_data(window: tauri::Window, extension_id: String) -> Result<Option<Value>, String> {
    require_main(&window)?;
    let (revision, _) = installed_files(window.app_handle(), &extension_id)?;
    let root = super::files::resolve_root(window.app_handle(), &extension_id, None)?;
    migrate_initial_files(window.app_handle(), &extension_id, &root)?;
    let registry = read_registry(&registry_path(window.app_handle())?)?;
    Ok(registry.get(&extension_id).and_then(|r| r.get(&revision)).and_then(|entry| entry.initial_data.clone()))
}

#[tauri::command]
pub fn legacy_ack_initial_data(window: tauri::Window, extension_id: String) -> Result<(), String> {
    require_main(&window)?;
    let (revision, _) = installed_files(window.app_handle(), &extension_id)?;
    let root = super::files::resolve_root(window.app_handle(), &extension_id, None)?;
    migrate_initial_files(window.app_handle(), &extension_id, &root)?;
    let state = window.state::<LegacyImports>();
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let path = registry_path(window.app_handle())?;
    let mut registry = read_registry(&path)?;
    let certificate = registry
        .get_mut(&extension_id)
        .and_then(|r| r.get_mut(&revision))
        .ok_or("Legacy import certificate missing")?;
    certificate.initial_data = None;
    save_registry(&path, &registry)
}

#[tauri::command]
pub fn legacy_cleanup_import(window: tauri::Window, extension_id: String) -> Result<(), String> {
    require_main(&window)?;
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|e| e.to_string())?;
    if snapshot.installations.iter().any(|i| i.id == extension_id)
        || snapshot.pending.iter().any(|p| p.id == extension_id)
    {
        return Err("Legacy cleanup requires a completed uninstall".into());
    }
    cleanup_import_records(window.app_handle(), &extension_id)
}

pub(crate) fn cleanup_import_records(app: &tauri::AppHandle, extension_id: &str) -> Result<(), String> {
    let state = app.state::<LegacyImports>();
    let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
    let path = registry_path(app)?;
    let mut registry = read_registry(&path)?;
    registry.remove(extension_id);
    save_registry(&path, &registry)?;
    drop(_guard);
    super::files::clear_grants(app, extension_id)
}

/// Follow file -> registry -> SDK order used by file migration and staged imports.
pub(crate) fn cleanup_uninstalled(
    app: &tauri::AppHandle, extension_id: &str, purge: bool, cleanup_files: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    super::files::with_file_lock(app, || {
        let state = app.state::<LegacyImports>();
        let _guard = state.registry_lock.lock().map_err(|_| "Legacy registry lock poisoned")?;
        alwith_extension::plugin::cleanup_uninstalled(app, extension_id, purge, || {
            let cleanup = (|| -> Result<(), String> {
                if purge {
                    let path = registry_path(app)?;
                    let mut registry = read_registry(&path)?;
                    registry.remove(extension_id);
                    save_registry(&path, &registry)?;
                    cleanup_files()?;
                }
                super::files::clear_grants_locked(app, extension_id)
            })();
            cleanup.map_err(|message| alwith_extension::ServiceError { code: "cleanupFailed".into(), message })
        })
        .map_err(|error| error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn previous_root_seed_is_consumed_after_first_successful_migration() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let nested = root.join(".alwith/extensions/yup-kb");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("workspaces.json"), b"[1]").unwrap();
        seed_previous_root(&root, &nested, "yup-kb").unwrap();
        assert_eq!(fs::read(nested.join("workspaces.json")).unwrap(), b"[1]");
        fs::remove_file(nested.join("workspaces.json")).unwrap();
        seed_previous_root(&root, &nested, "yup-kb").unwrap();
        assert!(!nested.join("workspaces.json").exists(), "removed data must not reappear from the old root");
        assert_eq!(fs::read(root.join("workspaces.json")).unwrap(), b"[1]");
    }
    #[test]
    fn unsupported_optional_legacy_icon_does_not_block_import() {
        let mut old = json!({"id":"weather-local","name":"Weather","version":"1.0.0","icon":"book-open"});
        assert!(converted_manifest(&old, None).unwrap().get("icon").is_none());
        old["icon"] = json!("globe");
        assert_eq!(converted_manifest(&old, None).unwrap()["icon"], "lucide:globe");
        old["icon"] = json!("https://example.com/icon.png");
        assert_eq!(converted_manifest(&old, None).unwrap()["icon"], old["icon"]);
    }
    #[test]
    fn old_nested_layout_seeds_missing_settings_without_replacing_edits() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let nested = root.join(".alwith/extensions/yup-kb");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("workspaces.json"), b"[1]").unwrap();
        seed_previous_root(&root, &nested, "yup-kb").unwrap();
        assert_eq!(fs::read(nested.join("workspaces.json")).unwrap(), b"[1]");
        fs::write(nested.join("workspaces.json"), b"[2]").unwrap();
        seed_previous_root(&root, &nested, "yup-kb").unwrap();
        migrate_named_files(&nested, &BTreeMap::from([("workspaces.json".into(), b"[3]".to_vec())])).unwrap();
        assert_eq!(fs::read(nested.join("workspaces.json")).unwrap(), b"[2]");
        assert_eq!(fs::read(root.join("workspaces.json")).unwrap(), b"[1]");
    }
    #[test]
    fn known_remote_loader_never_falls_back_for_an_unknown_id() {
        assert!(source_requires_download(LOADER_SHA256, None).is_err());
        assert!(!source_requires_download(&digest(b"local source"), None).unwrap());
        let p = profile("bi-metrics").unwrap().unwrap();
        assert!(source_requires_download(LOADER_SHA256, Some(&p)).unwrap());
        assert!(!source_requires_download(&p.source_sha256, Some(&p)).unwrap());
        assert!(source_requires_download(&digest(b"unreviewed"), Some(&p)).is_err());
    }
    #[test]
    fn settings_snapshot_has_an_aggregate_eight_mib_limit() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("data.json"), format!("[{}]", " ".repeat((MAX_SOURCE / 2 - 2) as usize))).unwrap();
        fs::write(dir.path().join("mutable.bin"), vec![0; (MAX_SOURCE / 2 + 1) as usize]).unwrap();
        assert!(snapshot_files(dir.path(), &["mutable.bin".into()]).is_err());
    }
    #[test]
    fn oversized_registry_write_preserves_the_readable_current_registry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("registry.json");
        save_registry(&path, &Registry::new()).unwrap();
        let certificate = Certificate {
            main_sha256: "a".into(),
            manifest_sha256: "b".into(),
            styles_sha256: "c".into(),
            initial_data: Some(json!("x".repeat(32 * 1024 * 1024))),
            file_sha256: BTreeMap::new(),
            data_files: BTreeMap::new(),
        };
        let registry = BTreeMap::from([("fixture".into(), BTreeMap::from([("revision".into(), certificate)]))]);
        assert!(save_registry(&path, &registry).is_err());
        assert!(read_registry(&path).unwrap().is_empty());
    }
    #[test]
    fn snapshot_rejects_invalid_named_json_data() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("workspaces.json"), "not json").unwrap();
        assert!(snapshot_files(dir.path(), &["workspaces.json".into()]).is_err());
    }
    #[test]
    fn all_resource_bytes_participate_in_package_revision() {
        let mut files =
            BTreeMap::from([("main.js".into(), b"entry".to_vec()), ("assets/image.png".into(), vec![0, 128, 255])]);
        let original = package_revision(&files);
        files.get_mut("assets/image.png").unwrap()[0] = 1;
        assert_ne!(package_revision(&files), original);
    }
    #[test]
    fn generic_wrapper_binds_original_source_and_captured_modules() {
        let old = json!({"id":"weather-local", "name":"Weather", "version":"1.0.0"});
        let source = "module.exports = class {};";
        let modules = BTreeMap::from([("helper.js".into(), "module.exports = 42".into())]);
        let payload = json!({"manifest":old,"source":source,"styles":"styles.css","modules":modules});
        let main = format!("{ENTRY_PREFIX}{payload}{ENTRY_SUFFIX}");
        assert!(validate_entry(&main, &old, &digest(source.as_bytes()), &modules).is_ok());
        assert!(validate_entry(&main, &old, &digest(b"changed"), &modules).is_err());
        assert!(validate_entry(&main, &old, &digest(source.as_bytes()), &BTreeMap::new()).is_err());
        let mut changed = old.clone();
        changed["name"] = json!("Forged");
        assert!(validate_entry(&main, &changed, &digest(source.as_bytes()), &modules).is_err());
    }
    #[test]
    fn original_certificate_format_remains_readable() {
        let certificate: Certificate = serde_json::from_value(
            json!({"mainSha256":"a","manifestSha256":"b","stylesSha256":"c","initialData":null}),
        )
        .unwrap();
        assert!(certificate.file_sha256.is_empty());
        assert!(certificate.data_files.is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn snapshot_rejects_symlink_assets() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.path().join("image.png")).unwrap();
        assert!(snapshot_files(dir.path(), &[]).is_err());
    }
    #[test]
    fn unrelated_legacy_dependencies_do_not_mark_a_modern_manifest() {
        let old = json!({"id":"weather-local","name":"Weather","version":"1.0.0","minAppVersion":"1.0.0","dependencies":{"obsidian":"*"}});
        assert!(is_legacy_manifest(&old).unwrap());
        let converted = converted_manifest(&old, None).unwrap();
        assert_eq!(converted["id"], "weather-local");
        assert_eq!(converted["dependencies"]["@alwith/module-extension"], "^0.1.6");
    }
    #[test]
    fn snapshots_resources_and_separates_named_mutable_data() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("main.js"), "module.exports = class {};").unwrap();
        fs::write(dir.path().join("assets/image.png"), [0, 128, 255]).unwrap();
        fs::write(dir.path().join("helper.js"), "module.exports = 42;").unwrap();
        fs::write(dir.path().join("constants.json"), "{\"value\":42}").unwrap();
        fs::write(dir.path().join("data.json"), "{\"secret\":true}").unwrap();
        fs::write(dir.path().join("workspaces.json"), "[]").unwrap();
        let (files, data) = snapshot_files(dir.path(), &["workspaces.json".into()]).unwrap();
        assert_eq!(files["assets/image.png"], [0, 128, 255]);
        assert!(files.contains_key("constants.json"));
        assert!(!files.contains_key("data.json"));
        assert!(!files.contains_key("workspaces.json"));
        assert_eq!(data["workspaces.json"], b"[]");
        fs::write(dir.path().join("assets/image.png"), "changed").unwrap();
        assert_eq!(files["assets/image.png"], [0, 128, 255]);
    }
    #[test]
    fn named_data_migrates_to_private_root_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let files = BTreeMap::from([("workspaces.json".into(), b"[]".to_vec())]);
        migrate_named_files(&root, &files).unwrap();
        assert_eq!(fs::read(dir.path().join("workspaces.json")).unwrap(), b"[]");
        fs::write(dir.path().join("workspaces.json"), b"[42]").unwrap();
        migrate_named_files(&root, &files).unwrap();
        assert_eq!(fs::read(dir.path().join("workspaces.json")).unwrap(), b"[42]");
    }
    #[test]
    fn generic_legacy_has_no_business_profile() {
        assert!(profile("weather-local").is_ok(), "unlisted local extensions must be accepted");
    }
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
        let p = profile("yup-kb").unwrap().unwrap();
        let old = json!({"id":"yup-kb","name":"YUP","version":"2.20.0","author":"","updateUrl":"https://example.com"});
        let manifest = converted_manifest(&old, Some(&p)).unwrap();
        assert_eq!(manifest["manifestVersion"], 3);
        assert_eq!(manifest["version"], "2.20.0");
        assert!(manifest.get("author").is_none());
        assert!(manifest.get("updateUrl").is_none());
        assert!(validate_entry("module.exports = function() {}", &old, &p.source_sha256, &BTreeMap::new()).is_err());
        let forged = format!(
            "{ENTRY_PREFIX}{}{ENTRY_SUFFIX}",
            json!({"manifest":old,"source":"unreviewed()","styles":"styles.css"})
        );
        assert!(validate_entry(&forged, &old, &p.source_sha256, &BTreeMap::new()).is_err());
        assert!(profile("unknown").unwrap().is_none());
    }
    #[test]
    fn public_service_installs_use_certified_revisions_and_reject_tampering() {
        use alwith_extension::{Request, Service};
        let root = tempfile::tempdir().unwrap();
        let package = tempfile::tempdir().unwrap();
        let mut p = profile("etms-strategy-review").unwrap().unwrap();
        p.id = "weather-local".into();
        assert!(profile(&p.id).unwrap().is_none());
        let old = json!({"id": p.id, "name": "ETMS", "version": "0.1.0"});
        let manifest = serde_json::to_vec(&converted_manifest(&old, Some(&p)).unwrap()).unwrap();
        let main = b"module.exports.default = function() {};";
        let styles = b".legacy { display: block; }";
        for (name, bytes) in
            [("manifest.json", manifest.as_slice()), ("main.js", main.as_slice()), ("styles.css", styles.as_slice())]
        {
            fs::write(package.path().join(name), bytes).unwrap();
        }
        let revision = package_revision(&BTreeMap::from([
            ("main.js".into(), main.to_vec()),
            ("manifest.json".into(), manifest.clone()),
            ("styles.css".into(), styles.to_vec()),
        ]));
        let mut registry = Registry::new();
        registry.entry(p.id.clone()).or_default().insert(
            revision.clone(),
            Certificate {
                main_sha256: digest(main),
                manifest_sha256: digest(&manifest),
                styles_sha256: digest(styles),
                initial_data: Some(json!({"fixture": true})),
                file_sha256: BTreeMap::new(),
                data_files: BTreeMap::new(),
            },
        );
        let mut service = Service::open(root.path()).unwrap();
        let dispatch = |service: &mut Service, value: Value| {
            service.dispatch("main", serde_json::from_value::<Request>(value).unwrap()).unwrap()
        };
        dispatch(&mut service, json!({"type":"installLocal", "path":package.path(), "source":SOURCE}));
        assert_eq!(service.snapshot().installations[0].package_revision, revision);
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .is_err()
        );
        dispatch(&mut service, json!({"type":"enable", "id":p.id}));
        assert_eq!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .unwrap(),
            revision
        );
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &Registry::new()))
                .is_err()
        );
        // Staging a different revision cannot revoke a working installation before commit.
        registry.get_mut(&p.id).unwrap().insert(
            "a".repeat(64),
            Certificate {
                main_sha256: digest(b"future"),
                manifest_sha256: digest(&manifest),
                styles_sha256: digest(styles),
                initial_data: None,
                file_sha256: BTreeMap::new(),
                data_files: BTreeMap::new(),
            },
        );
        assert_eq!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .unwrap(),
            revision
        );
        let installed = root.path().join(&p.id).join("packages").join(&revision);
        fs::write(installed.join("main.js"), "tampered").unwrap();
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .is_err()
        );
        fs::write(installed.join("main.js"), main).unwrap();
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .is_ok()
        );
        dispatch(&mut service, json!({"type":"beginTransition", "id":p.id, "action":"disable"}));
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .is_err()
        );
        dispatch(&mut service, json!({"type":"commitTransition", "id":p.id}));
        assert!(
            service
                .installed_package(&p.id, SOURCE)
                .map_err(|e| e.to_string())
                .and_then(|(identity, files)| check_installation(&identity, &files, &registry))
                .is_err()
        );

        let untrusted_root = tempfile::tempdir().unwrap();
        let mut untrusted = Service::open(untrusted_root.path()).unwrap();
        dispatch(&mut untrusted, json!({"type":"installLocal", "path":package.path(), "source":"local"}));
        dispatch(&mut untrusted, json!({"type":"enable", "id":p.id}));
        assert!(untrusted.installed_package(&p.id, SOURCE).is_err());
    }

    #[test]
    fn wrapper_payload_is_json_data_and_rejects_executable_suffixes() {
        let mut p = profile("etms-strategy-review").unwrap().unwrap();
        let old = json!({"id":p.id,"name":"ETMS","version":"0.1.0"});
        let source = "module.exports = class {};";
        p.source_sha256 = digest(source.as_bytes());
        let payload = json!({"manifest":old,"source":source,"styles":"styles.css"});
        let entry = format!("{ENTRY_PREFIX}{payload}{ENTRY_SUFFIX}");
        assert!(validate_entry(&entry, &old, &p.source_sha256, &BTreeMap::new()).is_ok());
        let injected = format!("{ENTRY_PREFIX}{payload}); evil(); ({ENTRY_SUFFIX}");
        assert!(validate_entry(&injected, &old, &p.source_sha256, &BTreeMap::new()).is_err());
        let wrong_styles =
            format!("{ENTRY_PREFIX}{}{ENTRY_SUFFIX}", json!({"manifest":old,"source":source,"styles":"data.json"}));
        assert!(validate_entry(&wrong_styles, &old, &p.source_sha256, &BTreeMap::new()).is_err());
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
