//! Explicit Move To routing without granting the webview an additional filesystem root.

use alwith_drive::ownership::canonical_target;
use alwith_drive::sync::{ProjectKind, RootInfo};
use alwith_fs::FileSystem;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Clone, serde::Serialize, specta::Type)]
pub struct CompletedMove {
    from: String,
    to: String,
}

#[derive(serde::Serialize, specta::Type)]
pub struct MoveToOutcome {
    moves: Vec<CompletedMove>,
    cloud: bool,
    error: Option<String>,
}

fn drive_destination<'a>(
    roots: &'a [RootInfo], directory: &Path, drive_root: &Path,
) -> Result<Option<&'a RootInfo>, String> {
    let mut matched = None;
    let mut depth = 0;
    for root in roots {
        if root.kind == ProjectKind::Skill || root.local_path.is_empty() {
            continue;
        }
        let path = canonical_target(Path::new(&root.local_path))?;
        if !path.starts_with(drive_root) || path == drive_root {
            return Err("Drive project escapes its owned directory".into());
        }
        if directory.starts_with(&path) && path.components().count() > depth {
            depth = path.components().count();
            matched = Some(root);
        }
    }
    Ok(matched)
}

fn move_plan(
    source_fs: &FileSystem, root: &Path, sources: &[PathBuf], directory: &Path,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    if sources.is_empty() {
        return Err("Select at least one move source".into());
    }
    let mut paths = Vec::new();
    let mut names = HashSet::new();
    for source in sources {
        let metadata = std::fs::symlink_metadata(source).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Symbolic links cannot be moved with Move To".into());
        }
        let source = source_fs.authorize_path(source)?;
        if source == root || directory.starts_with(&source) {
            return Err("Cannot move a workspace root or move a directory into itself".into());
        }
        if paths.iter().any(|(path, _): &(PathBuf, PathBuf)| source.starts_with(path) || path.starts_with(&source)) {
            return Err("Move selection contains overlapping sources".into());
        }
        let name = source.file_name().ok_or("Move source has no name")?;
        if !names.insert(name.to_os_string()) {
            return Err("Move sources have conflicting destination names".into());
        }
        let target = directory.join(name);
        if source == target {
            continue;
        }
        match std::fs::symlink_metadata(&target) {
            Ok(_) => return Err(format!("Move destination already exists: {}", target.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        paths.push((source, target));
    }
    Ok(paths)
}

#[tauri3_specta::command]
pub async fn workspace_move_to(
    window: tauri::WebviewWindow, root: PathBuf, sources: Vec<PathBuf>, destination: PathBuf,
) -> Result<MoveToOutcome, String> {
    if window.label() != "main" {
        return Err("Workspace access is limited to the main window".into());
    }
    let root = crate::workspace::authorize_preview_root(&root)?;
    let _operation = crate::workspace::OPERATIONS.lock().await;
    let source_fs = FileSystem::new([root.clone()])?;
    let directory = canonical_target(&destination)?;
    let state = window.app_handle().state::<crate::drive::DriveState>();
    let service = state.service()?;
    let snapshot = service.snapshot();
    let drive_root = canonical_target(Path::new(&snapshot.local_root))?;
    let target = drive_destination(&snapshot.roots, &directory, &drive_root)?;
    if !directory.starts_with(&root) && target.is_none() {
        return Err("Move destination must be in the current workspace or an indexed writable Drive project".into());
    }
    if let Some(target) = target
        && (!snapshot.running || !target.can_write || !target.sync_enabled || target.cloud_only)
    {
        return Err("Move destination is not a writable Drive project".into());
    }
    match std::fs::metadata(&directory) {
        Ok(metadata) if !metadata.is_dir() => return Err("Move destination is not a directory".into()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let plan = move_plan(&source_fs, &root, &sources, &directory)?;
    let cloud = target.is_some_and(|target| !target.selected || !directory.is_dir());
    let moves = plan
        .iter()
        .map(|(from, to)| CompletedMove {
            from: from.to_string_lossy().replace('\\', "/"),
            to: to.to_string_lossy().replace('\\', "/"),
        })
        .collect::<Vec<_>>();
    if plan.is_empty() {
        return Ok(MoveToOutcome { moves, cloud, error: None });
    }
    let sources = plan.iter().map(|(from, _)| from.clone()).collect::<Vec<_>>();
    if cloud {
        let (moved, error) = service.move_to_cloud_directory(&sources, &directory).await?;
        return Ok(MoveToOutcome { moves: moves.into_iter().take(moved).collect(), cloud: true, error });
    }
    if !directory.is_dir() {
        return Err("Move destination directory must already exist".into());
    }
    let mut granted = vec![root.clone()];
    if let Some(target) = target {
        let target_root = canonical_target(Path::new(&target.local_path))?;
        if !target_root.starts_with(&root) {
            granted.push(target_root);
        }
    }
    let filesystem = FileSystem::new(granted)?;
    let mut completed_moves = Vec::new();
    let mut started = false;
    let result = service
        .with_move_to_filesystem(&sources, &directory, async {
            started = true;
            for (index, ((from, to), completed)) in plan.iter().zip(&moves).enumerate() {
                filesystem.move_between_roots(from.clone(), to.clone()).await.map_err(|error| {
                    format!("Moved {index} of {} items; remaining items were not moved: {error}", plan.len())
                })?;
                completed_moves.push(completed.clone());
            }
            Ok(())
        })
        .await;
    match result {
        Ok(()) => Ok(MoveToOutcome { moves: completed_moves, cloud: false, error: None }),
        Err(error) if started => Ok(MoveToOutcome { moves: completed_moves, cloud: false, error: Some(error) }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_conflicts_are_detected_before_any_file_moves() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("target")).unwrap();
        std::fs::write(root.join("a.txt"), "first").unwrap();
        std::fs::write(root.join("b.txt"), "second").unwrap();
        std::fs::write(root.join("target/b.txt"), "existing").unwrap();
        let fs = FileSystem::new([root.clone()]).unwrap();
        assert!(move_plan(&fs, &root, &[root.join("a.txt"), root.join("b.txt")], &root.join("target")).is_err());
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(root.join("target/b.txt")).unwrap(), "existing");
    }

    #[test]
    fn move_plan_rejects_roots_self_moves_overlaps_and_outside_sources() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("folder/nested")).unwrap();
        std::fs::write(root.join("folder/file.txt"), "source").unwrap();
        std::fs::write(outside.path().join("other.txt"), "outside").unwrap();
        let fs = FileSystem::new([root.clone()]).unwrap();
        assert!(move_plan(&fs, &root, std::slice::from_ref(&root), outside.path()).is_err());
        assert!(move_plan(&fs, &root, &[root.join("folder")], &root.join("folder/nested")).is_err());
        assert!(move_plan(&fs, &root, &[root.join("folder"), root.join("folder/file.txt")], outside.path()).is_err());
        assert!(move_plan(&fs, &root, &[outside.path().join("other.txt")], &root).is_err());
        assert!(move_plan(&fs, &root, &[root.join("folder/file.txt")], &root.join("folder")).unwrap().is_empty());
    }
}
