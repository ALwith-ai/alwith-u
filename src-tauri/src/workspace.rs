//! U's coordination of the shared filesystem plugin: every workspace mutation runs inside a Drive
//! transaction, cross-project moves go through Drive, and conversation patches wait for unsaved
//! editor buffers. Opening, reading, watching and patching are the plugin's commands.
use alwith_drive::Drive;
use alwith_fs::{Change, ChangeKind, FileSystem, NativeError, Operation, Workspace};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Workspace access is limited to the main window".into());
    }
    Ok(())
}

/// The canonical root, only if the main window opened it through the filesystem plugin.
pub(crate) fn authorize_preview_root(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    app.state::<Workspace>().root(path).map_err(|error| error.message)
}

const UNSAVED: &str = "Save or close unsaved editor files before changing conversation patches";

/// Wraps each plugin mutation in U's Drive coordination.
pub struct Coordinator;
impl alwith_fs::Coordinator for Coordinator {
    fn coordinate(&self, app: &tauri::AppHandle, change: Change, operation: Operation) -> Operation {
        let app = app.clone();
        Box::pin(async move {
            let drive = app.state::<Drive>();
            let service = drive.service()?;
            match &change.kind {
                ChangeKind::Move { .. } => {
                    // The plugin authorized [destination, source] as the move's writes.
                    let [to, from] = change.writes.as_slice() else {
                        return Err(NativeError::new("invalidParams", "A move names its source and destination"));
                    };
                    if service.move_between_projects(from, to).await? {
                        return Ok(());
                    }
                }
                ChangeKind::WriteFile => {
                    if let (Some(owner), [path]) = (&change.collaboration_owner, change.writes.as_slice()) {
                        return service.with_collaborative_filesystem(path, owner, operation).await;
                    }
                }
                ChangeKind::Patches { .. } => {
                    if is_dirty() {
                        return Err(NativeError::new("dirty", UNSAVED));
                    }
                    let guarded = async move {
                        // Buffers may have changed while Drive held synchronization.
                        if is_dirty() {
                            return Err(NativeError::new("dirty", UNSAVED));
                        }
                        operation.await
                    };
                    return service.with_filesystem(&change.writes, &change.removed, guarded).await;
                }
                _ => {}
            }
            service.with_filesystem(&change.writes, &change.removed, operation).await
        })
    }
}

fn is_dirty() -> bool {
    DIRTY.load(std::sync::atomic::Ordering::Acquire)
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
    // Quit is also available while main is hidden; make its save confirmation reachable.
    if let Err(error) = crate::window::show_main_window(app.clone()) {
        log::error!("Cannot show workspace shutdown confirmation: {error}");
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
    let root = authorize_preview_root(window.app_handle(), &root)?;
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
    let workspace = window.app_handle().state::<Workspace>();
    let _operation = workspace.lock().await;
    let drive = window.app_handle().state::<Drive>();
    let drive = drive.service().map_err(|error| error.message)?;
    for source in sources {
        let parent = source.parent().ok_or("Import source has no parent")?;
        let name = source.file_name().ok_or("Import source has no name")?.to_str().ok_or("Import name is not UTF-8")?;
        let directory = source.is_dir();
        let (stem, extension) = if directory {
            (name, "")
        } else {
            match name.rfind('.') {
                Some(index) if index > 0 => (&name[..index], &name[index..]),
                _ => (name, ""),
            }
        };
        let mut target = destination.join(name);
        let mut counter = 1;
        while target.try_exists().map_err(|error| error.to_string())? {
            let suffix = if counter == 1 { " copy".to_string() } else { format!(" copy {counter}") };
            target = destination.join(format!("{stem}{suffix}{extension}"));
            counter += 1;
        }
        let fs = FileSystem::new([root.clone(), parent.to_path_buf()]).map_err(|error| error.message)?;
        let writes = [fs.authorize_path(&target).map_err(|error| error.message)?];
        drive
            .with_filesystem(&writes, &[], fs.workspace_copy(&root, &source, &target))
            .await
            .map_err(|error| format!("Import stopped at {}: {error}", source.display()))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "__tests__/file_patches.rs"]
mod file_patch_tests;
