use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Package {
    pub id: String,
    pub version: String,
    pub digest: String,
    pub source: String,
    pub fingerprint: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Task {
    pub id: String,
    pub original: String,
    pub extension_id: String,
    pub fingerprint: String,
    pub package: Option<Package>,
    pub baseline: Option<String>,
    pub committed: bool,
    pub cleaning: bool,
    pub cleaned: bool,
    pub cleanup_entries: Option<BTreeMap<String, String>>,
    pub error: Option<String>,
}

pub(super) fn plain(path: &Path) -> Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Links are not allowed: {}", path.display()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(format!("Reparse points are not allowed: {}", path.display()));
        }
    }
    if !metadata.is_dir() && !metadata.is_file() {
        return Err(format!("Unsupported file: {}", path.display()));
    }
    Ok(metadata)
}

pub(super) fn exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

pub(super) fn directory(path: &Path) -> Result<()> {
    if !exists(path)? {
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(0o700).create(path).map_err(|e| e.to_string())?;
        }
        #[cfg(not(unix))]
        fs::create_dir(path).map_err(|e| e.to_string())?;
        sync_dir(path.parent().ok_or("Directory has no parent")?)?;
    }
    if !plain(path)?.is_dir() {
        return Err("Expected a directory".into());
    }
    Ok(())
}

pub(super) fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(path).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(super) fn save(root: &Path, task: &Task) -> Result<()> {
    directory(root)?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(task).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Import record exceeds 8 MiB".into());
    }
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.flush().and_then(|_| file.as_file().sync_all()).map_err(|e| e.to_string())?;
    file.persist(root.join("task.json")).map_err(|e| e.to_string())?;
    sync_dir(root)
}

pub(super) fn load(root: &Path) -> Result<Task> {
    plain(root)?;
    let file = root.join("task.json");
    if !plain(&file)?.is_file() {
        return Err("Invalid import record".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(&file)
        .map_err(|e| e.to_string())?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Import record is too large".into());
    }
    let task: Task = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if root.file_name().and_then(|n| n.to_str()) != Some(&task.id)
        || uuid::Uuid::parse_str(&task.id).is_err()
        || Path::new(&task.original).components().count() != 1
        || !matches!(Path::new(&task.original).components().next(), Some(std::path::Component::Normal(_)))
    {
        return Err("Invalid import record identity".into());
    }
    Ok(task)
}

pub(super) struct Tree {
    pub entries: BTreeMap<String, String>,
    pub files: BTreeMap<String, Vec<u8>>,
    pub fingerprint: String,
}

pub(super) fn tree(root: &Path) -> Result<Tree> {
    fn walk(
        root: &Path, path: &Path, files: &mut BTreeMap<String, Vec<u8>>, entries: &mut BTreeMap<String, String>,
        total: &mut usize,
    ) -> Result<()> {
        let meta = plain(path)?;
        let name = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("Non-UTF-8 package path")?
            .replace(std::path::MAIN_SEPARATOR, "/");
        if entries.len() >= 4096 {
            return Err("Too many package entries".into());
        }
        if meta.is_dir() {
            entries.insert(name, "directory".into());
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                walk(root, &entry.map_err(|e| e.to_string())?.path(), files, entries, total)?;
            }
        } else {
            let mut bytes = Vec::new();
            fs::File::open(path)
                .map_err(|e| e.to_string())?
                .take((64 * 1024 * 1024 - *total + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            *total += bytes.len();
            if *total > 64 * 1024 * 1024 {
                return Err("Import exceeds 64 MiB".into());
            }
            entries.insert(name.clone(), hex::encode(Sha256::digest(&bytes)));
            files.insert(name, bytes);
        }
        Ok(())
    }
    if !plain(root)?.is_dir() {
        return Err("Package must be a directory".into());
    }
    let mut files = BTreeMap::new();
    let mut entries = BTreeMap::new();
    walk(root, root, &mut files, &mut entries, &mut 0)?;
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(&entries).map_err(|e| e.to_string())?));
    Ok(Tree { files, fingerprint, entries })
}

pub(super) fn copy_tree(root: &Path, tree: &Tree) -> Result<()> {
    directory(root)?;
    for (name, bytes) in &tree.files {
        let path = root.join(name);
        let parent = path.parent().ok_or("Missing package parent")?;
        let mut current = root.to_path_buf();
        for part in parent.strip_prefix(root).map_err(|e| e.to_string())?.components() {
            current.push(part);
            directory(&current)?;
        }
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(bytes).and_then(|_| file.as_file().sync_all()).map_err(|e| e.to_string())?;
        file.persist(&path).map_err(|e| e.to_string())?;
        sync_dir(parent)?;
    }
    sync_dir(root)
}

pub(super) fn task_root(processing: &Path, id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid task ID")?;
    let path = processing.join(id);
    if !plain(&path)?.is_dir() {
        return Err("Invalid task directory".into());
    }
    Ok(path)
}

// Validate the entire tree before recursive deletion; never follow directory links.
pub(super) fn remove_tree(path: &Path) -> Result<()> {
    if exists(path)? {
        tree(path)?;
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        sync_dir(path.parent().ok_or("Missing parent")?)?;
    }
    Ok(())
}
