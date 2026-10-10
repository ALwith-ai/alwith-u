use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use alwith_extension::filesystem::{FileEntry, FileOperation, FileRequest, FileResponse, perform_file};
#[cfg(test)]
use alwith_extension::filesystem::{MAX_BYTES, read_scoped};
pub(super) use alwith_extension::filesystem::{open_scope, scoped_path};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::require_installation;

#[derive(Default)]
pub struct LegacyFiles {
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct DirectoryGrant {
    scope: String,
    path: String,
}

type Grants = BTreeMap<String, Vec<DirectoryGrant>>;

fn grant_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("legacy-directory-grants.json"))
}

fn read_grants(path: &Path) -> Result<Grants, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| format!("Read legacy directory grants: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Grants::new()),
        Err(error) => Err(format!("Read legacy directory grants: {error}")),
    }
}

fn write_grants(path: &Path, grants: &Grants) -> Result<(), String> {
    let parent = path.parent().ok_or("Legacy grants path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, grants).map_err(|error| format!("Save legacy grants: {error}"))?;
    file.as_file().sync_all().map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| format!("Save legacy grants: {error}"))?;
    Ok(())
}

fn existing_private_root(root: &Path, extension_id: &str) -> Result<PathBuf, String> {
    let directory = open_scope(root)?;
    let nested = scoped_path(&directory, &format!(".alwith/extensions/{extension_id}"))?;
    match directory.metadata(&nested) {
        Ok(metadata) if metadata.is_dir() => Ok(root.join(nested)),
        Ok(_) => Err("Previous legacy private root is not a directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(root.into()),
        Err(error) => Err(format!("Inspect previous legacy private root: {error}")),
    }
}

pub(super) fn resolve_root(app: &tauri::AppHandle, extension_id: &str, scope: Option<&str>) -> Result<PathBuf, String> {
    if let Some(scope) = scope {
        let grants = read_grants(&grant_path(app)?)?;
        return resolve_granted_root(&grants, extension_id, scope);
    }
    let app_root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_root).map_err(|error| error.to_string())?;
    let app_root = fs::canonicalize(app_root).map_err(|error| error.to_string())?;
    let directory = open_scope(&app_root)?;
    let relative = scoped_path(&directory, &format!("legacy-extension-files/{extension_id}"))?;
    directory.create_dir_all(&relative).map_err(|error| format!("Create legacy private directory: {error}"))?;
    let root = app_root.join(relative);
    let selected = existing_private_root(&root, extension_id)?;
    if selected != root {
        super::importer::seed_previous_root(&root, &selected, extension_id)?;
    }
    Ok(selected)
}

fn resolve_granted_root(grants: &Grants, extension_id: &str, scope: &str) -> Result<PathBuf, String> {
    let grant = grants
        .get(extension_id)
        .and_then(|grants| grants.iter().find(|grant| grant.scope == scope))
        .ok_or("Directory is not authorized for this extension; select it again")?;
    Ok(PathBuf::from(&grant.path))
}

fn perform_private_file(
    root: &Path, request: FileRequest, files: &BTreeMap<String, Vec<u8>>,
) -> Result<FileResponse, String> {
    let directory = open_scope(root)?;
    let path = scoped_path(&directory, &request.path)?;
    let name = path.to_str().ok_or("Invalid legacy path")?;
    let exists = directory.try_exists(&path).map_err(|e| e.to_string())?;
    let prefix = if name == "." { String::new() } else { format!("{name}/") };
    let mut package_entries = BTreeMap::new();
    for resource in files.keys().filter_map(|resource| resource.strip_prefix(&prefix)) {
        let (child, is_directory) = resource.split_once('/').map_or((resource, false), |(child, _)| (child, true));
        package_entries
            .insert(child.to_owned(), FileEntry { name: child.into(), is_file: !is_directory, is_directory });
    }
    if matches!(request.operation, FileOperation::List) && (!package_entries.is_empty() || exists) {
        if exists {
            let FileResponse::List { entries } = perform_file(root, request)? else { unreachable!() };
            // Private data takes precedence over package resources at the same path.
            for entry in entries {
                package_entries.insert(entry.name.clone(), entry);
            }
        }
        return Ok(FileResponse::List { entries: package_entries.into_values().collect() });
    }
    if !exists {
        match request.operation {
            FileOperation::Read => {
                if let Some(body) = files.get(name) {
                    return Ok(FileResponse::Read { body: body.clone() });
                }
            }
            FileOperation::Stat => {
                if let Some(body) = files.get(name) {
                    return Ok(FileResponse::Stat {
                        exists: true,
                        size: body.len() as u64,
                        mtime: None,
                        is_file: true,
                        is_directory: false,
                    });
                }
                if !package_entries.is_empty() {
                    return Ok(FileResponse::Stat {
                        exists: true,
                        size: 0,
                        mtime: None,
                        is_file: false,
                        is_directory: true,
                    });
                }
            }
            _ => {}
        }
    }
    perform_file(root, request)
}

pub(super) fn with_file_lock<T>(
    app: &tauri::AppHandle, operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<LegacyFiles>();
    let _guard = state.lock.lock().map_err(|_| "Legacy file state is poisoned")?;
    operation()
}

pub(super) fn clear_grants_locked(app: &tauri::AppHandle, extension_id: &str) -> Result<(), String> {
    let path = grant_path(app)?;
    let mut grants = read_grants(&path)?;
    grants.remove(extension_id);
    write_grants(&path, &grants)
}

pub(crate) fn clear_grants(app: &tauri::AppHandle, extension_id: &str) -> Result<(), String> {
    with_file_lock(app, || clear_grants_locked(app, extension_id))
}

fn require_file_installation(window: &tauri::Window, extension_id: &str, legacy_only: bool) -> Result<bool, String> {
    if legacy_only {
        require_installation(window, extension_id)?;
        return Ok(true);
    }
    let installation = crate::extension_capabilities::require_installation(window, extension_id)?;
    let legacy = installation.source == "legacy:alwith-u";
    if legacy {
        super::importer::require_legacy_installation(window.app_handle(), extension_id)?;
    }
    Ok(legacy)
}

fn create_modern_private_root(app_root: &Path, extension_id: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(app_root).map_err(|error| format!("Create extension data root: {error}"))?;
    let app_root = fs::canonicalize(app_root).map_err(|error| error.to_string())?;
    let directory = open_scope(&app_root)?;
    let relative = scoped_path(&directory, &format!("extension-files/{extension_id}"))?;
    directory.create_dir_all(&relative).map_err(|error| format!("Create extension private directory: {error}"))?;
    Ok(app_root.join(relative))
}

fn validate_common_file(root: &Path, request: &FileRequest) -> Result<(), String> {
    if request.scope.is_none() {
        let directory = open_scope(root)?;
        let path = scoped_path(&directory, &request.path)?;
        if path
            .components()
            .next()
            .is_some_and(|part| part.as_os_str().to_string_lossy().eq_ignore_ascii_case("data.json"))
        {
            return Err("data.json is managed by extension context.data".into());
        }
    }
    Ok(())
}

fn validate_legacy_file(root: &Path, request: &FileRequest, home: &Path) -> Result<(), String> {
    let directory = open_scope(root)?;
    let path = root.join(scoped_path(&directory, &request.path)?);
    let archive = match fs::canonicalize(home.join(".alwith/projects")) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Inspect Desktop archive directory: {error}")),
    };
    let target = match fs::canonicalize(&path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => path,
        Err(error) => return Err(format!("Inspect legacy file: {error}")),
    };
    if target.starts_with(archive) {
        return Err("会话归档暂不支持，其他知识库功能可用".into());
    }
    Ok(())
}

async fn file_command(
    window: tauri::Window, extension_id: String, request: FileRequest, legacy_only: bool,
) -> Result<FileResponse, String> {
    require_file_installation(&window, &extension_id, legacy_only)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Extension file state is poisoned")?;
        let legacy = require_file_installation(&window, &extension_id, legacy_only)?;
        let root = if legacy || request.scope.is_some() {
            resolve_root(&app, &extension_id, request.scope.as_deref())?
        } else {
            create_modern_private_root(&app.path().app_data_dir().map_err(|error| error.to_string())?, &extension_id)?
        };
        if legacy {
            validate_legacy_file(&root, &request, &app.path().home_dir().map_err(|error| error.to_string())?)?;
        }
        if !legacy_only {
            validate_common_file(&root, &request)?;
        }
        if legacy
            && request.scope.is_none()
            && matches!(request.operation, FileOperation::Read | FileOperation::Stat | FileOperation::List)
        {
            super::importer::migrate_initial_files(&app, &extension_id, &root)?;
            let files = super::importer::package_files(&app, &extension_id)?;
            return perform_private_file(&root, request, &files);
        }
        perform_file(&root, request)
    })
    .await
    .map_err(|error| format!("Extension file task failed: {error}"))?
}

#[tauri3_specta::command]
pub async fn extension_file(
    window: tauri::Window, extension_id: String, request: crate::extension_wire::FileRequest,
) -> Result<crate::extension_wire::FileResponse, String> {
    file_command(window, extension_id, request.into(), false).await.map(Into::into)
}

#[tauri3_specta::command]
pub async fn legacy_file(
    window: tauri::Window, extension_id: String, request: crate::extension_wire::FileRequest,
) -> Result<crate::extension_wire::FileResponse, String> {
    file_command(window, extension_id, request.into(), true).await.map(Into::into)
}

async fn directories_command(
    window: tauri::Window, extension_id: String, legacy_only: bool,
) -> Result<Vec<DirectoryGrant>, String> {
    require_file_installation(&window, &extension_id, legacy_only)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Extension file state is poisoned")?;
        require_file_installation(&window, &extension_id, legacy_only)?;
        let mut grants = read_grants(&grant_path(&app)?)?;
        // Retain inaccessible grants in storage so a disconnected volume is not silently revoked.
        Ok(grants.remove(&extension_id).unwrap_or_default())
    })
    .await
    .map_err(|error| format!("Extension directories task failed: {error}"))?
}

#[tauri3_specta::command]
pub async fn extension_directories(window: tauri::Window, extension_id: String) -> Result<Vec<DirectoryGrant>, String> {
    directories_command(window, extension_id, false).await
}

#[tauri3_specta::command]
pub async fn legacy_directories(window: tauri::Window, extension_id: String) -> Result<Vec<DirectoryGrant>, String> {
    directories_command(window, extension_id, true).await
}

async fn pick_directory_command(
    window: tauri::Window, extension_id: String, legacy_only: bool,
) -> Result<Option<DirectoryGrant>, String> {
    require_file_installation(&window, &extension_id, legacy_only)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(format!("Authorize folder access for {extension_id}"))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|error| format!("Selected directory is not a local path: {error}"))?;
        let path = fs::canonicalize(path).map_err(|error| format!("Resolve selected directory: {error}"))?;
        open_scope(&path)?;
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Extension file state is poisoned")?;
        // Recheck after user interaction: the extension may now be disabled or uninstalled.
        require_file_installation(&window, &extension_id, legacy_only)?;
        let registry_path = grant_path(&app)?;
        let mut registry = read_grants(&registry_path)?;
        let grants = registry.entry(extension_id).or_default();
        let path = path.into_os_string().into_string().map_err(|_| "Selected directory is not valid UTF-8")?;
        if let Some(existing) = grants.iter().find(|grant| grant.path == path) {
            return Ok(Some(existing.clone()));
        }
        let grant = DirectoryGrant { scope: uuid::Uuid::new_v4().to_string(), path };
        grants.push(grant.clone());
        write_grants(&registry_path, &registry)?;
        Ok(Some(grant))
    })
    .await
    .map_err(|error| format!("Extension directory picker failed: {error}"))?
}

#[tauri3_specta::command]
pub async fn extension_pick_directory(
    window: tauri::Window, extension_id: String,
) -> Result<Option<DirectoryGrant>, String> {
    pick_directory_command(window, extension_id, false).await
}

#[tauri3_specta::command]
pub async fn legacy_pick_directory(
    window: tauri::Window, extension_id: String,
) -> Result<Option<DirectoryGrant>, String> {
    pick_directory_command(window, extension_id, true).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(operation: FileOperation, path: &str) -> FileRequest {
        FileRequest { operation, scope: None, path: path.into(), body: None, recursive: false }
    }

    #[test]
    fn legacy_archive_reads_remain_unsupported_even_with_a_parent_directory_grant() {
        let temp = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(temp.path()).unwrap();
        let archive = home.join(".alwith/projects/project");
        fs::create_dir_all(&archive).unwrap();
        fs::write(archive.join("session.jsonl"), b"private conversation").unwrap();
        assert!(
            validate_legacy_file(&home, &request(FileOperation::Read, ".alwith/projects/project/session.jsonl"), &home)
                .is_err()
        );
        assert!(validate_legacy_file(&archive, &request(FileOperation::Read, "session.jsonl"), &home).is_err());
        fs::create_dir_all(home.join("business/.alwith/projects")).unwrap();
        assert!(validate_legacy_file(&home, &request(FileOperation::List, "business/.alwith/projects"), &home).is_ok());
    }

    #[test]
    fn modern_private_roots_are_isolated_from_legacy_and_other_extensions() {
        let temp = tempfile::tempdir().unwrap();
        let first = create_modern_private_root(temp.path(), "first").unwrap();
        let second = create_modern_private_root(temp.path(), "second").unwrap();
        assert_eq!(first, fs::canonicalize(temp.path()).unwrap().join("extension-files/first"));
        assert_ne!(first, second);
        assert!(first.is_dir() && second.is_dir());
        assert!(!temp.path().join("legacy-extension-files").exists());
        assert!(create_modern_private_root(temp.path(), "../escape").is_err());
    }

    #[test]
    fn common_private_files_cannot_replace_managed_configuration() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        for path in ["data.json", "./data.json", "././data.json", "DATA.JSON", "./Data.Json"] {
            assert!(validate_common_file(&root, &request(FileOperation::Write, path)).is_err());
        }
        assert!(validate_common_file(&root, &request(FileOperation::Write, "notes.json")).is_ok());
        let mut selected = request(FileOperation::Read, "data.json");
        selected.scope = Some("selected-directory".into());
        assert!(validate_common_file(&root, &selected).is_ok());
    }

    #[test]
    fn existing_nested_private_edits_remain_authoritative() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let nested = root.join(".alwith/extensions/yup-kb");
        assert_eq!(existing_private_root(&root, "yup-kb").unwrap(), root);
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("workspaces.json"), b"[1]").unwrap();
        fs::write(nested.join("workspaces.json"), b"[2]").unwrap();
        let selected = existing_private_root(&root, "yup-kb").unwrap();
        assert_eq!(selected, nested);
        assert_eq!(read_scoped(&selected, "workspaces.json").unwrap(), b"[2]");
    }
    #[cfg(unix)]
    #[test]
    fn existing_nested_private_root_rejects_symlink_ancestors() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        std::os::unix::fs::symlink("/tmp", root.join(".alwith")).unwrap();
        assert!(existing_private_root(&root, "yup-kb").is_err());
    }
    #[test]
    fn package_resources_are_readable_and_listed_with_private_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let files =
            BTreeMap::from([("assets/image.png".into(), vec![0, 128, 255]), ("constants.json".into(), b"{}".to_vec())]);
        let FileResponse::Read { body } =
            perform_private_file(&root, request(FileOperation::Read, "assets/image.png"), &files).unwrap()
        else {
            panic!("read");
        };
        assert_eq!(body, [0, 128, 255]);
        let FileResponse::Stat { exists, is_directory, .. } =
            perform_private_file(&root, request(FileOperation::Stat, "assets"), &files).unwrap()
        else {
            panic!("stat");
        };
        assert!(exists && is_directory);
        let FileResponse::List { entries } =
            perform_private_file(&root, request(FileOperation::List, "."), &files).unwrap()
        else {
            panic!("list");
        };
        assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["assets", "constants.json"]);
        fs::write(root.join("constants.json"), b"private").unwrap();
        let FileResponse::Read { body } =
            perform_private_file(&root, request(FileOperation::Read, "constants.json"), &files).unwrap()
        else {
            panic!("read");
        };
        assert_eq!(body, b"private");
        assert!(perform_private_file(&root, request(FileOperation::Read, "../constants.json"), &files).is_err());
    }
    #[test]
    fn file_operations_preserve_bytes_and_report_real_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let mut mkdir = request(FileOperation::Mkdir, "nested/exports");
        mkdir.recursive = true;
        perform_file(&root, mkdir).unwrap();
        let mut write = request(FileOperation::Write, "nested/exports/a.bin");
        write.body = Some(vec![0, 128, 255]);
        perform_file(&root, write).unwrap();
        assert_eq!(fs::read(root.join("nested/exports/a.bin")).unwrap(), [0, 128, 255]);
        let FileResponse::Stat { exists, size, is_file, is_directory, mtime } =
            perform_file(&root, request(FileOperation::Stat, "nested/exports/a.bin")).unwrap()
        else {
            panic!("expected stat");
        };
        assert!(exists && is_file && !is_directory);
        assert_eq!(size, 3);
        assert!(mtime.is_some());
        let FileResponse::List { entries } =
            perform_file(&root, request(FileOperation::List, "nested/exports")).unwrap()
        else {
            panic!("expected list");
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "a.bin");
        assert!(entries[0].is_file && !entries[0].is_directory);
        perform_file(&root, request(FileOperation::Remove, "nested/exports/a.bin")).unwrap();
        let FileResponse::Stat { exists, .. } =
            perform_file(&root, request(FileOperation::Stat, "nested/exports/a.bin")).unwrap()
        else {
            panic!("expected stat");
        };
        assert!(!exists);
    }

    #[test]
    fn refuses_traversal_root_deletion_and_oversized_reads() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        for path in ["../outside", "/absolute", "nested/../../outside", "C:\\outside", "nested\\..\\outside"] {
            assert!(perform_file(&root, request(FileOperation::Mkdir, path)).is_err(), "{path}");
        }
        let mut remove = request(FileOperation::Remove, ".");
        remove.recursive = true;
        assert!(perform_file(&root, remove).is_err());
        let file = fs::File::create(root.join("too-large")).unwrap();
        file.set_len(MAX_BYTES as u64 + 1).unwrap();
        assert!(read_scoped(&root, "too-large").is_err());
        assert!(root.exists());
    }

    #[test]
    fn grants_survive_restart_and_remain_bound_to_extension() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("grants.json");
        let grants = BTreeMap::from([(
            "yup-kb".into(),
            vec![DirectoryGrant { scope: "opaque-token".into(), path: "/authorized/project".into() }],
        )]);
        write_grants(&path, &grants).unwrap();
        let restored = read_grants(&path).unwrap();
        assert_eq!(restored["yup-kb"][0].scope, "opaque-token");
        assert_eq!(restored["yup-kb"][0].path, "/authorized/project");
        assert_eq!(
            resolve_granted_root(&restored, "yup-kb", "opaque-token").unwrap(),
            Path::new("/authorized/project")
        );
        assert!(resolve_granted_root(&restored, "bi-metrics", "opaque-token").is_err());
        assert!(resolve_granted_root(&restored, "yup-kb", "unknown-token").is_err());
    }

    #[test]
    fn binary_reads_stay_inside_directory_capability() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("data.bin"), [0, 128, 255]).unwrap();
        let canonical = std::fs::canonicalize(root.path()).unwrap();
        assert_eq!(read_scoped(&canonical, "data.bin").unwrap(), [0, 128, 255]);
        assert!(read_scoped(&canonical, "../outside").is_err());
        assert!(read_scoped(&canonical, "/etc/passwd").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_files_and_ancestors() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("link")).unwrap();
        let canonical = std::fs::canonicalize(root.path()).unwrap();
        assert!(read_scoped(&canonical, "escape/secret").is_err());
        assert!(read_scoped(&canonical, "link").is_err());
    }
}
