use alwith_fs::FileSystem;
use alwith_fs::workspace::{Request, execute};
use alwith_fs::workspace::{WorkspaceWatcher, watch};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static OPERATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
fn roots() -> &'static Mutex<HashSet<PathBuf>> {
    ROOTS.get_or_init(|| Mutex::new(HashSet::new()))
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Workspace access is limited to the main window".into());
    }
    Ok(())
}

fn workspace_root(path: &Path) -> Result<PathBuf, String> {
    let root = path.canonicalize().map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("Workspace must be a directory".into());
    }
    Ok(root)
}

/// Opening a project in the main window establishes its scoped filesystem session.
#[tauri3_specta::command]
pub async fn workspace_open(window: tauri::WebviewWindow, path: PathBuf) -> Result<String, String> {
    main_window(&window)?;
    let root = workspace_root(&path)?;
    let name = root.to_str().ok_or("Workspace path is not UTF-8")?.to_owned();
    roots().lock().map_err(|error| error.to_string())?.insert(root);
    Ok(name)
}

#[tauri3_specta::command]
pub async fn workspace_file(window: tauri::WebviewWindow, request: Value) -> Result<Value, String> {
    main_window(&window)?;
    let mut request: Request = serde_json::from_value(request).map_err(|error| error.to_string())?;
    let root = request.root.canonicalize().map_err(|error| error.to_string())?;
    if !roots().lock().map_err(|error| error.to_string())?.contains(&root) {
        return Err("Workspace root has not been authorized".into());
    }
    request.root = root.clone();
    let _operation = OPERATIONS.lock().await;
    let fs = FileSystem::new([root])?;
    execute(&fs, request).await
}

static WATCHERS: OnceLock<Mutex<HashMap<PathBuf, WorkspaceWatcher>>> = OnceLock::new();
#[tauri3_specta::command]
pub async fn workspace_watch(window: tauri::WebviewWindow, path: PathBuf, enabled: bool) -> Result<(), String> {
    main_window(&window)?;
    let root = path.canonicalize().map_err(|error| error.to_string())?;
    if !roots().lock().map_err(|error| error.to_string())?.contains(&root) {
        return Err("Workspace root has not been authorized".into());
    }
    let mut watchers = WATCHERS.get_or_init(|| Mutex::new(HashMap::new())).lock().map_err(|error| error.to_string())?;
    if !enabled {
        watchers.remove(&root);
        return Ok(());
    }
    if watchers.contains_key(&root) {
        return Ok(());
    }
    let fs = FileSystem::new([root.clone()])?;
    let event_root = root.to_string_lossy().replace('\\', "/");
    let watcher = watch(fs, root.clone(), move |result| {
        let payload = match result {
            Ok(paths) => {
                serde_json::json!({ "root": event_root, "paths": paths.iter().map(|path| path.to_string_lossy().replace('\\', "/")).collect::<Vec<_>>(), "error": null })
            }
            Err(error) => serde_json::json!({ "root": event_root, "paths": [], "error": error }),
        };
        if let Err(error) = window.emit("workspace:change", payload) {
            log::error!("Workspace notification failed: {error}");
        }
    })?;
    watchers.insert(root, watcher);
    Ok(())
}

static DIRTY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[tauri3_specta::command]
pub fn workspace_dirty(window: tauri::WebviewWindow, dirty: bool) -> Result<(), String> {
    main_window(&window)?;
    DIRTY.store(dirty, std::sync::atomic::Ordering::Release);
    Ok(())
}
pub fn prevent_exit(app: &tauri::AppHandle) -> bool {
    if !DIRTY.load(std::sync::atomic::Ordering::Acquire) {
        return false;
    }
    if let Err(error) = app.emit_to("main", "workspace:shutdown", ()) {
        log::error!("Cannot request workspace shutdown: {error}");
    }
    true
}
#[tauri3_specta::command]
pub fn workspace_exit(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Manager;
    main_window(&window)?;
    DIRTY.store(false, std::sync::atomic::Ordering::Release);
    window.app_handle().exit(0);
    Ok(())
}

/// Import only the explicitly confirmed source paths; never grant their parents to the webview.
#[tauri3_specta::command]
pub async fn workspace_import(
    window: tauri::WebviewWindow, root: PathBuf, destination: PathBuf, paths: Vec<PathBuf>,
) -> Result<(), String> {
    main_window(&window)?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if !roots().lock().map_err(|error| error.to_string())?.contains(&root) {
        return Err("Workspace root has not been authorized".into());
    }
    let destination = destination.canonicalize().map_err(|error| error.to_string())?;
    if !destination.starts_with(&root) || !destination.is_dir() {
        return Err("Import destination must be a directory inside the workspace".into());
    }
    if paths.is_empty() {
        return Err("No import sources selected".into());
    }
    let mut sources = Vec::new();
    for path in paths {
        if std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?.file_type().is_symlink() {
            return Err("Importing symbolic links is not supported".into());
        }
        let source = path.canonicalize().map_err(|error| error.to_string())?;
        if destination.starts_with(&source) {
            return Err("Cannot import a folder into itself".into());
        }
        sources.push(source);
    }
    let chinese = sys_locale::get_locale().is_some_and(|locale| locale.starts_with("zh"));
    let names = sources.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join("\n");
    let message = if chinese {
        format!("将以下文件或文件夹复制到 {}？\n{}", destination.display(), names)
    } else {
        format!("Copy these files or folders into {}?\n{}", destination.display(), names)
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().message(message).title("ALwith U").buttons(MessageDialogButtons::OkCancel).show(move |allowed| {
        let _ = sender.send(allowed);
    });
    if !receiver.await.map_err(|error| error.to_string())? {
        return Ok(());
    }
    let _operation = OPERATIONS.lock().await;
    for source in sources {
        let parent = source.parent().ok_or("Import source has no parent")?;
        let name = source.file_name().ok_or("Import source has no name")?.to_str().ok_or("Import name is not UTF-8")?;
        let directory = source.is_dir();
        let (stem, extension) = if !directory {
            match name.rfind('.') {
                Some(index) if index > 0 => (&name[..index], &name[index..]),
                _ => (name, ""),
            }
        } else {
            (name, "")
        };
        let mut target = destination.join(name);
        let mut counter = 1;
        while target.try_exists().map_err(|error| error.to_string())? {
            let suffix = if counter == 1 { " copy".to_string() } else { format!(" copy {counter}") };
            target = destination.join(format!("{stem}{suffix}{extension}"));
            counter += 1;
        }
        let fs = FileSystem::new([root.clone(), parent.to_path_buf()])?;
        let request = Request {
            root: root.clone(),
            operation: "copy".into(),
            path: source.clone(),
            to: Some(target),
            data: None,
            mode: None,
            expected_version: None,
            show_hidden: None,
            show_ignored: None,
        };
        execute(&fs, request).await.map_err(|error| format!("Import stopped at {}: {error}", source.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn opening_a_workspace_requires_an_existing_directory() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(workspace_root(directory.path()).unwrap(), directory.path().canonicalize().unwrap());
        assert!(workspace_root(&directory.path().join("missing")).is_err());
        let file = directory.path().join("file.txt");
        std::fs::write(&file, "content").unwrap();
        assert!(workspace_root(&file).unwrap_err().contains("must be a directory"));
    }

    #[test]
    fn an_open_workspace_does_not_allow_parent_or_sibling_access() {
        let directory = tempfile::tempdir().unwrap();
        let project = directory.path().join("project");
        let sibling = directory.path().join("project-other");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        let root = workspace_root(&project).unwrap();
        let fs = FileSystem::new([root.clone()]).unwrap();
        assert!(fs.authorize_path(&root).is_ok());
        assert!(fs.authorize_path(&directory.path().canonicalize().unwrap()).is_err());
        assert!(fs.authorize_path(&sibling.canonicalize().unwrap()).is_err());
    }
}
