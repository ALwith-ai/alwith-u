//! One startup pass imports owned input snapshots; SDK state remains authoritative.
mod storage;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use storage::*;
use tauri::Manager;

#[derive(Default)]
pub(crate) struct InboxState {
    started: AtomicBool,
    active: Mutex<Option<String>>,
}

#[derive(Serialize, specta::Type)]
pub(crate) struct Scan {
    tasks: Vec<String>,
    errors: Vec<String>,
}
#[derive(Serialize, specta::Type)]
pub(crate) struct PreparedPackage {
    path: String,
    id: String,
    version: String,
    digest: String,
    source: String,
}
#[derive(Serialize, specta::Type)]
pub(crate) struct PreparedTask {
    id: String,
    phase: String,
    package: Option<PreparedPackage>,
}

fn roots(window: &tauri::Window) -> Result<(PathBuf, PathBuf)> {
    if window.label() != "main" {
        return Err("Only the main window processes startup imports".into());
    }
    let root = window.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    plain(&root)?;
    let inbox = root.join("extension-inbox");
    let processing = root.join("extension-processing");
    directory(&inbox)?;
    directory(&processing)?;
    Ok((inbox, processing))
}

fn manifest_id(tree: &Tree) -> Result<String> {
    let manifest: serde_json::Value =
        serde_json::from_slice(tree.files.get("manifest.json").ok_or("Missing manifest.json")?)
            .map_err(|e| e.to_string())?;
    let id = manifest.get("id").and_then(|v| v.as_str()).ok_or("Missing extension ID")?;
    if id.is_empty()
        || id.len() > 64
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("Invalid extension ID".into());
    }
    Ok(id.into())
}

fn claim(inbox: &std::path::Path, processing: &std::path::Path, name: &str, expected: &str) -> Result<Task> {
    let source = inbox.join(name);
    let current = tree(&source)?;
    if current.fingerprint != expected {
        return Err("Package is still changing; retry next startup".into());
    }
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        original: name.into(),
        extension_id: manifest_id(&current)?,
        fingerprint: current.fingerprint,
        package: None,
        baseline: None,
        committed: false,
        cleaning: false,
        cleaned: false,
        cleanup_entries: None,
        error: None,
    };
    let target = processing.join(&task.id);
    // Persist intent before moving bytes so a crash between rename and commit is recoverable.
    save(&target, &task)?;
    fs::rename(&source, target.join("source")).map_err(|e| e.to_string())?;
    sync_dir(inbox)?;
    sync_dir(&target)?;
    Ok(task)
}

#[tauri3_specta::command]
pub(crate) async fn extension_inbox_scan(window: tauri::Window) -> Result<Scan> {
    let (inbox, processing) = roots(&window)?;
    if window.state::<InboxState>().started.swap(true, Ordering::SeqCst) {
        return Ok(Scan { tasks: vec![], errors: vec![] });
    }
    scan(&inbox, &processing).await
}

fn input_name(path: &std::path::Path) -> Result<Option<String>> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Non-UTF-8 import name: {}", path.display()))?;
    Ok((!name.starts_with('.')).then(|| name.to_owned()))
}

async fn scan(inbox: &std::path::Path, processing: &std::path::Path) -> Result<Scan> {
    let mut result = Scan { tasks: vec![], errors: vec![] };
    let mut counts = BTreeMap::<String, usize>::new();
    let mut recovered = Vec::new();
    for entry in fs::read_dir(processing).map_err(|e| e.to_string())? {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(error) => {
                result.errors.push(error.to_string());
                continue;
            }
        };
        match load(&path) {
            Ok(task) if !task.cleaned => {
                *counts.entry(task.extension_id.clone()).or_default() += 1;
                recovered.push(task);
            }
            Ok(_) => {}
            Err(error) => result.errors.push(format!("{}: {error}", path.display())),
        }
    }
    let mut candidates = Vec::new();
    for entry in fs::read_dir(inbox).map_err(|e| e.to_string())? {
        let path = match entry {
            Ok(entry) => entry.path(),
            Err(error) => {
                result.errors.push(error.to_string());
                continue;
            }
        };
        let name = match input_name(&path) {
            Ok(Some(name)) => name,
            Ok(None) => continue,
            Err(error) => {
                result.errors.push(error);
                continue;
            }
        };
        if candidates.len() >= 128 {
            result.errors.push("At most 128 input packages are processed per startup".into());
            break;
        }
        match tree(&path).and_then(|snapshot| Ok((manifest_id(&snapshot)?, snapshot))) {
            Ok((id, snapshot)) => {
                // A persisted claim may still refer to its original inbox path after a crash.
                if recovered.iter().any(|t| {
                    t.original == name
                        && !processing.join(&t.id).join("source").exists()
                        && t.fingerprint == snapshot.fingerprint
                }) {
                    continue;
                }
                *counts.entry(id.clone()).or_default() += 1;
                candidates.push((name, id, snapshot.fingerprint));
            }
            Err(error) => result.errors.push(format!("{}: {error}", path.display())),
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    recovered.sort_by(|a, b| a.id.cmp(&b.id));
    for task in recovered {
        if counts[&task.extension_id] > 1 && !task.committed {
            result.errors.push(format!(
                "Duplicate input for {}; retained at {}",
                task.extension_id,
                processing.join(&task.id).display()
            ));
        } else {
            result.tasks.push(task.id);
        }
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, id, snapshot) in candidates {
        if counts[&id] > 1 {
            result.errors.push(format!("Duplicate input for {id}: {name}"));
            continue;
        }
        match claim(inbox, processing, &name, &snapshot) {
            Ok(task) => result.tasks.push(task.id),
            Err(error) => result.errors.push(format!("{name}: {error}")),
        }
    }
    Ok(result)
}

fn verify_selected(window: &tauri::Window, task: &Task) -> Result<()> {
    let pkg = task.package.as_ref().ok_or("Task has no prepared package")?;
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|e| e.to_string())?;
    if snapshot.pending.iter().any(|p| p.id == pkg.id) {
        return Err("Extension is still transitioning".into());
    }
    if !snapshot
        .installations
        .iter()
        .any(|i| i.id == pkg.id && i.source == pkg.source && i.package_revision == pkg.digest)
    {
        return Err("Installed package no longer matches this task; source retained".into());
    }
    Ok(())
}

#[tauri3_specta::command]
pub(crate) async fn extension_inbox_prepare(window: tauri::Window, task_id: String) -> Result<PreparedTask> {
    let (inbox, processing) = roots(&window)?;
    {
        let state = window.state::<InboxState>();
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("Another startup import is active".into());
        }
        *active = Some(task_id.clone());
    }
    let root = task_root(&processing, &task_id)?;
    let mut task = load(&root)?;
    if task.cleaned {
        return Err("Task is already cleaned".into());
    }
    if task.committed {
        verify_selected(&window, &task)?;
        return Ok(PreparedTask { id: task_id, phase: "committed".into(), package: None });
    }
    let source = root.join("source");
    if !exists(&source)? {
        let original = inbox.join(&task.original);
        if tree(&original)?.fingerprint != task.fingerprint {
            return Err("Claim source has changed; source retained".into());
        }
        fs::rename(&original, &source).map_err(|e| e.to_string())?;
        sync_dir(&inbox)?;
        sync_dir(&root)?;
    }
    if tree(&source)?.fingerprint != task.fingerprint {
        return Err("Claimed input changed; source retained".into());
    }
    let package_path = root.join("package");
    if task.package.is_none() {
        // A crash before preparation committed may leave an incomplete package, never an installed selection.
        remove_tree(&package_path)?;
        let staged = crate::legacy_extensions::importer::prepare_startup_package(window.clone(), &source).await?;
        copy_tree(&package_path, &tree(std::path::Path::new(&staged.path))?)?;
        task.package = Some(Package {
            id: staged.id,
            version: staged.version,
            digest: staged.digest,
            source: staged.source,
            fingerprint: tree(&package_path)?.fingerprint,
        });
        task.error = None;
        save(&root, &task)?;
    }
    let package = task.package.as_ref().ok_or("Missing prepared package")?;
    if package.id != task.extension_id {
        return Err("Prepared identity differs from input".into());
    }
    if tree(&package_path)?.fingerprint != package.fingerprint {
        return Err("Prepared package changed; retained for inspection".into());
    }
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|e| e.to_string())?;
    if snapshot.pending.iter().any(|p| p.id == package.id) {
        return Err("Extension is transitioning".into());
    }
    let installed = snapshot.installations.iter().find(|i| i.id == package.id);
    let baseline = serde_json::to_string(&installed.map(|i| (&i.installation_id, &i.package_revision, &i.source)))
        .map_err(|e| e.to_string())?;
    if let Some(previous) = &task.baseline
        && previous != &baseline
        && !installed.is_some_and(|i| i.package_revision == package.digest && i.source == package.source)
    {
        return Err("Installation changed since this task started; automatic replay refused".into());
    }
    alwith_extension::plugin::grant_install(window.app_handle(), window.label(), &package_path, &package.source)
        .map_err(|e| e.to_string())?;
    let result = PreparedTask {
        id: task_id,
        phase: "prepared".into(),
        package: Some(PreparedPackage {
            path: package_path.to_str().ok_or("Invalid package path")?.into(),
            id: package.id.clone(),
            version: package.version.clone(),
            digest: package.digest.clone(),
            source: package.source.clone(),
        }),
    };
    if task.baseline.is_none() {
        task.baseline = Some(baseline);
        save(&root, &task)?;
    }
    Ok(result)
}

fn cleanup(root: &std::path::Path, task: &mut Task) -> Result<()> {
    if !task.committed {
        return Err("Cannot clean an uncommitted task".into());
    }
    if !task.cleaning {
        let source = tree(&root.join("source"))?;
        if source.fingerprint != task.fingerprint {
            return Err("Source changed after installation; retained".into());
        }
        task.cleanup_entries = Some(source.entries);
        task.cleaning = true;
        save(root, task)?;
    }
    let source = root.join("source");
    if exists(&source)? {
        let expected = task.cleanup_entries.as_ref().ok_or("Missing cleanup inventory")?;
        if tree(&source)?.entries.iter().any(|(name, hash)| expected.get(name) != Some(hash)) {
            return Err("Remaining source changed during cleanup; retained".into());
        }
        remove_tree(&source)?;
    }
    remove_tree(&root.join("package"))?;
    task.cleaned = true;
    task.error = None;
    save(root, task)
}

#[tauri3_specta::command]
pub(crate) fn extension_inbox_complete(window: tauri::Window, task_id: String) -> Result<()> {
    let (_, processing) = roots(&window)?;
    let state = window.state::<InboxState>();
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active.as_deref() != Some(&task_id) {
        return Err("Task is not active".into());
    }
    let root = task_root(&processing, &task_id)?;
    let mut task = load(&root)?;
    verify_selected(&window, &task)?;
    task.committed = true;
    task.error = None;
    save(&root, &task)?;
    cleanup(&root, &mut task)?;
    *active = None;
    Ok(())
}

#[tauri3_specta::command]
pub(crate) fn extension_inbox_failed(window: tauri::Window, task_id: String, message: String) -> Result<()> {
    let (_, processing) = roots(&window)?;
    {
        let state = window.state::<InboxState>();
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.as_deref() != Some(&task_id) {
            return Err("Task is not active".into());
        }
        *active = None;
    }
    let root = task_root(&processing, &task_id)?;
    let mut task = load(&root)?;
    task.error = Some(message.chars().take(4096).collect());
    save(&root, &task)
}

#[cfg(test)]
#[path = "../__tests__/extension_inbox.rs"]
mod tests;
