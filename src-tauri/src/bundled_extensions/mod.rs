use serde::Serialize;
use std::{collections::BTreeSet, fs, path::Path};
use tauri::Manager;

// Stable provenance also checked by the frontend capability policy.
const BUNDLED_SOURCE: &str = "bundled:alwith-u";

#[derive(Debug, Serialize)]
pub struct BundledExtension {
    path: String,
    id: String,
    version: String,
    source: String,
}

fn resolve_bundles(root: &Path) -> Result<Vec<BundledExtension>, String> {
    let mut paths = fs::read_dir(root)
        .map_err(|e| format!("Read bundled extensions: {e}"))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Read bundled extension entry: {e}"))?;
    paths.sort();
    let mut ids = BTreeSet::new();
    let mut bundles = Vec::new();
    for path in paths {
        let kind = fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type();
        if kind.is_symlink() {
            return Err(format!("Bundled extension entries cannot be symbolic links: {}", path.display()));
        }
        if !kind.is_dir() {
            continue;
        }
        let id = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid bundle directory name")?;
        if id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || id.starts_with('-')
        {
            return Err(format!("Invalid bundled extension directory: {id}"));
        }
        let manifest_path = path.join("manifest.json");
        let manifest_kind =
            fs::symlink_metadata(&manifest_path).map_err(|e| format!("Read bundled extension {id}: {e}"))?.file_type();
        if manifest_kind.is_symlink() || !manifest_kind.is_file() {
            return Err(format!("Bundled extension {id} manifest must be a regular file, not symbolic links"));
        }
        let manifest: alwith_extension::Manifest =
            serde_json::from_slice(&fs::read(&manifest_path).map_err(|e| format!("Read bundled extension {id}: {e}"))?)
                .map_err(|e| format!("Invalid bundled extension {id} manifest: {e}"))?;
        if !ids.insert(manifest.id.clone()) {
            return Err(format!("Duplicate bundled extension identity: {}", manifest.id));
        }
        if manifest.id != id {
            return Err(format!("Bundled extension identity mismatch: {id}"));
        }
        bundles.push(BundledExtension {
            path: path.to_str().ok_or("Invalid bundle path")?.into(),
            id: manifest.id,
            version: manifest.version,
            source: BUNDLED_SOURCE.into(),
        });
    }
    Ok(bundles)
}

#[tauri::command]
pub fn extension_bundles(window: tauri::Window) -> Result<Vec<BundledExtension>, String> {
    if window.label() != "main" {
        return Err("Only the main window installs bundled extensions".into());
    }
    let root = if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/extensions")
    } else {
        window.app_handle().path().resource_dir().map_err(|e| e.to_string())?.join("extensions")
    };
    let bundles = resolve_bundles(&root)?;
    for bundle in &bundles {
        alwith_extension::plugin::grant_install(
            window.app_handle(),
            window.label(),
            Path::new(&bundle.path),
            &bundle.source,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(bundles)
}

#[cfg(test)]
mod tests;
