use std::path::PathBuf;

fn resolve_directory(cwd: Option<PathBuf>) -> Result<PathBuf, String> {
    let directory = cwd.ok_or("A project directory is required; the adapter owns the default chat directory")?;
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(format!("Project directory is unavailable: {}", directory.display()));
    }
    Ok(directory)
}

#[tauri3_specta::command]
pub async fn draft_directory(cwd: Option<PathBuf>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        resolve_directory(cwd)?
            .into_os_string()
            .into_string()
            .map_err(|_| "Project directory is not valid UTF-8".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_explicit_projects_without_creating_directories() {
        let root = tempfile::tempdir().unwrap();
        assert!(resolve_directory(None).is_err());
        let missing = root.path().join("removed-project");
        assert!(resolve_directory(Some(missing.clone())).is_err());
        assert!(!missing.exists());
        assert_eq!(resolve_directory(Some(root.path().to_owned())).unwrap(), root.path());
    }
}
