//! Read-only existence checks do not grant workspace access or materialize cloud roots.
use std::path::{Component, Path, PathBuf};

pub(super) fn exists(base: &Path, roots: &[PathBuf], path: &Path) -> Result<bool, String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("Drive path must be absolute without parent traversal".into());
    }
    let root = roots
        .iter()
        .filter(|root| root.starts_with(base) && path.starts_with(root))
        .max_by_key(|root| root.components().count())
        .ok_or("This path does not belong to an indexed Drive project")?;
    let canonical = match path.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_base = base.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_root.starts_with(canonical_base) || !canonical.starts_with(canonical_root) {
        return Err("Drive path escapes its indexed project".into());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_project_is_false_without_creating_it() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("cloud-only");
        assert!(!exists(base.path(), std::slice::from_ref(&root), &root).unwrap());
        assert!(!root.exists());
    }

    #[test]
    fn existing_and_missing_entries_are_distinct_from_invalid_paths() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("project");
        std::fs::create_dir(&root).unwrap();
        let file = root.join("note.md");
        std::fs::write(&file, "test").unwrap();
        let roots = [root.clone()];
        assert!(exists(base.path(), &roots, &file).unwrap());
        assert!(!exists(base.path(), &roots, &root.join("missing.md")).unwrap());
        assert!(exists(base.path(), &roots, &base.path().join("outside")).is_err());
        assert!(exists(base.path(), &roots, &root.join("../outside")).is_err());
        assert!(exists(base.path(), &roots, &file.join("child")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_project_or_drive() {
        let base = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = base.path().join("project");
        std::fs::create_dir(&root).unwrap();
        let link = root.join("escape");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(exists(base.path(), std::slice::from_ref(&root), &link).is_err());
        let project_link = base.path().join("linked-project");
        std::os::unix::fs::symlink(outside.path(), &project_link).unwrap();
        assert!(exists(base.path(), std::slice::from_ref(&project_link), &project_link).is_err());
    }
}
