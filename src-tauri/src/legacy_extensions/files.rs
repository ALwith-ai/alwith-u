use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::{MAX_BYTES, require_installation};

#[derive(Default)]
pub struct LegacyFiles {
    lock: Mutex<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DirectoryGrant {
    scope: String,
    path: String,
}

type Grants = BTreeMap<String, Vec<DirectoryGrant>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileOperation {
    Read,
    Write,
    Mkdir,
    Remove,
    List,
    Stat,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRequest {
    operation: FileOperation,
    scope: Option<String>,
    path: String,
    body: Option<Vec<u8>>,
    #[serde(default)]
    recursive: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    is_file: bool,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileResponse {
    Read { body: Vec<u8> },
    List { entries: Vec<FileEntry> },
    Stat { exists: bool, size: u64, mtime: Option<u64>, is_file: bool, is_directory: bool },
    Ok,
}

fn open_scope(root: &Path) -> Result<Dir, String> {
    let canonical = fs::canonicalize(root).map_err(|error| format!("Open authorized directory: {error}"))?;
    if canonical != root || fs::symlink_metadata(root).map_err(|error| error.to_string())?.file_type().is_symlink() {
        return Err("Authorized directory was moved or replaced by a symbolic link; select it again".into());
    }
    Dir::open_ambient_dir(canonical, ambient_authority()).map_err(|error| format!("Open authorized directory: {error}"))
}

fn scoped_path(directory: &Dir, value: &str) -> Result<PathBuf, String> {
    // Reject Windows separators on every platform so grants cannot change meaning on migration.
    if value.contains('\\') || value.contains('\0') || value.contains(':') {
        return Err("Legacy file paths must be relative paths inside the authorized directory".into());
    }
    let mut path = PathBuf::new();
    for part in Path::new(value).components() {
        match part {
            Component::Normal(name) => path.push(name),
            Component::CurDir => continue,
            _ => return Err("Legacy file paths cannot leave the authorized directory".into()),
        }
        match directory.symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Legacy file paths cannot contain symbolic links".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect legacy file path: {error}")),
        }
    }
    if path.as_os_str().is_empty() {
        path.push(".");
    }
    Ok(path)
}

fn read_scoped(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    let directory = open_scope(root)?;
    let path = scoped_path(&directory, path)?;
    let file = directory.open(path).map_err(|error| format!("Open legacy file: {error}"))?;
    let metadata = file.metadata().map_err(|error| format!("Inspect legacy file: {error}"))?;
    if !metadata.is_file() {
        return Err("Legacy reads require a regular file".into());
    }
    if metadata.len() > MAX_BYTES as u64 {
        return Err("Legacy file exceeds 64 MiB".into());
    }
    let mut body = Vec::new();
    file.take(MAX_BYTES as u64 + 1).read_to_end(&mut body).map_err(|error| format!("Read legacy file: {error}"))?;
    if body.len() > MAX_BYTES {
        return Err("Legacy file exceeds 64 MiB".into());
    }
    Ok(body)
}

fn perform_file(root: &Path, request: FileRequest) -> Result<FileResponse, String> {
    let directory = open_scope(root)?;
    let path = scoped_path(&directory, &request.path)?;
    match request.operation {
        FileOperation::Read => Ok(FileResponse::Read { body: read_scoped(root, &request.path)? }),
        FileOperation::Write => {
            let body = request.body.ok_or("Legacy write requires binary body")?;
            if body.len() > MAX_BYTES {
                return Err("Legacy file exceeds 64 MiB".into());
            }
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            let mut file = directory
                .open_with(&path, &options)
                .map_err(|error| format!("Open legacy file for writing: {error}"))?;
            file.write_all(&body).map_err(|error| format!("Write legacy file: {error}"))?;
            Ok(FileResponse::Ok)
        }
        FileOperation::Mkdir => {
            let result = if request.recursive { directory.create_dir_all(&path) } else { directory.create_dir(&path) };
            result.map_err(|error| format!("Create legacy directory: {error}"))?;
            Ok(FileResponse::Ok)
        }
        FileOperation::Remove => {
            if path == Path::new(".") {
                return Err("Cannot remove an authorized directory root".into());
            }
            let metadata =
                directory.symlink_metadata(&path).map_err(|error| format!("Inspect legacy removal target: {error}"))?;
            let result = if metadata.is_dir() {
                if request.recursive { directory.remove_dir_all(&path) } else { directory.remove_dir(&path) }
            } else {
                directory.remove_file(&path)
            };
            result.map_err(|error| format!("Remove legacy file: {error}"))?;
            Ok(FileResponse::Ok)
        }
        FileOperation::List => {
            let mut entries = directory
                .read_dir(&path)
                .map_err(|error| format!("List legacy directory: {error}"))?
                .map(|entry| {
                    let entry = entry.map_err(|error| format!("Read legacy directory entry: {error}"))?;
                    let kind = entry.file_type().map_err(|error| format!("Inspect legacy directory entry: {error}"))?;
                    Ok(FileEntry {
                        name: entry
                            .file_name()
                            .into_string()
                            .map_err(|_| "Legacy directory entry is not valid UTF-8")?,
                        is_file: kind.is_file(),
                        is_directory: kind.is_dir(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            entries.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(FileResponse::List { entries })
        }
        FileOperation::Stat => match directory.metadata(&path) {
            Ok(metadata) => Ok(FileResponse::Stat {
                exists: true,
                size: metadata.len(),
                mtime: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.into_std().duration_since(UNIX_EPOCH).ok())
                    .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
                is_file: metadata.is_file(),
                is_directory: metadata.is_dir(),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(FileResponse::Stat { exists: false, size: 0, mtime: None, is_file: false, is_directory: false })
            }
            Err(error) => Err(format!("Inspect legacy file: {error}")),
        },
    }
}

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

fn resolve_root(app: &tauri::AppHandle, extension_id: &str, scope: Option<&str>) -> Result<PathBuf, String> {
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
    Ok(app_root.join(relative))
}

fn resolve_granted_root(grants: &Grants, extension_id: &str, scope: &str) -> Result<PathBuf, String> {
    let grant = grants
        .get(extension_id)
        .and_then(|grants| grants.iter().find(|grant| grant.scope == scope))
        .ok_or("Directory is not authorized for this extension; select it again")?;
    Ok(PathBuf::from(&grant.path))
}

#[tauri::command]
pub async fn legacy_file(
    window: tauri::Window, extension_id: String, request: FileRequest,
) -> Result<FileResponse, String> {
    require_installation(&window, &extension_id)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Legacy file state is poisoned")?;
        let root = resolve_root(&app, &extension_id, request.scope.as_deref())?;
        perform_file(&root, request)
    })
    .await
    .map_err(|error| format!("Legacy file task failed: {error}"))?
}

#[tauri::command]
pub async fn legacy_directories(window: tauri::Window, extension_id: String) -> Result<Vec<DirectoryGrant>, String> {
    require_installation(&window, &extension_id)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Legacy file state is poisoned")?;
        let mut grants = read_grants(&grant_path(&app)?)?;
        // Retain inaccessible grants in storage so a disconnected volume is not silently revoked.
        Ok(grants.remove(&extension_id).unwrap_or_default())
    })
    .await
    .map_err(|error| format!("Legacy directories task failed: {error}"))?
}

#[tauri::command]
pub async fn legacy_pick_directory(
    window: tauri::Window, extension_id: String,
) -> Result<Option<DirectoryGrant>, String> {
    require_installation(&window, &extension_id)?;
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
        // Recheck after user interaction: an extension may have been disabled while the dialog was open.
        require_installation(&window, &extension_id)?;
        let state = app.state::<LegacyFiles>();
        let _guard = state.lock.lock().map_err(|_| "Legacy file state is poisoned")?;
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
    .map_err(|error| format!("Legacy directory picker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(operation: FileOperation, path: &str) -> FileRequest {
        FileRequest { operation, scope: None, path: path.into(), body: None, recursive: false }
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
