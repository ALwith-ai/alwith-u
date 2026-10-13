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
    owner: Mutex<Option<InboxOwner>>,
}

struct InboxOwner {
    window: String,
    token: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scan {
    operation_id: Option<String>,
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

fn reserve(state: &InboxState, owner: &str) -> Result<String> {
    let mut current = state.owner.lock().map_err(|e| e.to_string())?;
    if current.is_some() {
        return Err("Another extension inbox operation is active".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    *current = Some(InboxOwner { window: owner.into(), token: token.clone() });
    Ok(token)
}

fn lock_owner<'a>(
    state: &'a InboxState, window: &str, token: &str,
) -> Result<std::sync::MutexGuard<'a, Option<InboxOwner>>> {
    let owner = state.owner.lock().map_err(|e| e.to_string())?;
    if !owner.as_ref().is_some_and(|o| o.window == window && o.token == token) {
        return Err("Extension inbox operation is no longer active in this window".into());
    }
    Ok(owner)
}

async fn scan_owned(window: &tauri::Window, extension_id: Option<&str>) -> Result<Scan> {
    let (inbox, processing) = roots(window)?;
    let state = window.state::<InboxState>();
    let token = reserve(&state, window.label())?;
    let result = scan_for_owned(&inbox, &processing, extension_id, Some((&state, window.label(), &token))).await;
    match result {
        Ok(mut result) => {
            result.operation_id = Some(token);
            Ok(result)
        }
        Err(error) => {
            let mut owner = state.owner.lock().map_err(|e| e.to_string())?;
            if owner.as_ref().is_some_and(|o| o.token == token) {
                *owner = None;
            }
            Err(error)
        }
    }
}

#[tauri3_specta::command]
pub(crate) async fn extension_inbox_scan(window: tauri::Window) -> Result<Scan> {
    if window.label() != "main" {
        return Err("Only the main window starts automatic imports".into());
    }
    let state = window.state::<InboxState>();
    if state.started.load(Ordering::SeqCst) {
        // A reloaded main WebView still needs its startup promise to settle.
        return Ok(Scan { operation_id: Some(reserve(&state, window.label())?), tasks: vec![], errors: vec![] });
    }
    let result = scan_owned(&window, None).await?;
    state.started.store(true, Ordering::SeqCst);
    Ok(result)
}

#[tauri3_specta::command]
pub(crate) async fn extension_inbox_scan_extension(window: tauri::Window, extension_id: String) -> Result<Scan> {
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|e| e.to_string())?;
    let installed = snapshot.installations.iter().find(|i| i.id == extension_id).ok_or("Extension is not installed")?;
    if !installed.enabled || snapshot.pending.iter().any(|p| p.id == extension_id) {
        return Err("Extension is disabled or transitioning".into());
    }
    scan_owned(&window, Some(&extension_id)).await
}

#[tauri3_specta::command]
pub(crate) fn extension_inbox_finish(window: tauri::Window, operation_id: String) -> Result<()> {
    let state = window.state::<InboxState>();
    let mut owner = lock_owner(&state, window.label(), &operation_id)?;
    if state.active.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Extension inbox task is still active".into());
    }
    *owner = None;
    Ok(())
}

pub(crate) fn window_closed(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<InboxState>();
    cancel_window(&state, label);
}

fn cancel_window(state: &InboxState, label: &str) {
    // Navigation and destruction cancel the old coordinator, not its persisted tasks.
    let mut owner = state.owner.lock().expect("extension inbox owner lock poisoned");
    if owner.as_ref().is_some_and(|o| o.window == label) {
        *state.active.lock().expect("extension inbox active lock poisoned") = None;
        *owner = None;
    }
}

fn input_name(path: &std::path::Path) -> Result<Option<String>> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Non-UTF-8 import name: {}", path.display()))?;
    Ok((!name.starts_with('.')).then(|| name.to_owned()))
}

#[cfg(test)]
async fn scan(inbox: &std::path::Path, processing: &std::path::Path) -> Result<Scan> {
    scan_for(inbox, processing, None).await
}

#[cfg(test)]
async fn scan_for(inbox: &std::path::Path, processing: &std::path::Path, extension_id: Option<&str>) -> Result<Scan> {
    scan_for_owned(inbox, processing, extension_id, None).await
}

async fn scan_for_owned(
    inbox: &std::path::Path, processing: &std::path::Path, extension_id: Option<&str>,
    operation: Option<(&InboxState, &str, &str)>,
) -> Result<Scan> {
    let mut result = Scan { operation_id: None, tasks: vec![], errors: vec![] };
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
            Ok(task) if !task.cleaned && extension_id.is_none_or(|id| id == task.extension_id) => {
                *counts.entry(task.extension_id.clone()).or_default() += 1;
                recovered.push(task);
            }
            Ok(_) => {}
            Err(error) if extension_id.is_none() => result.errors.push(format!("{}: {error}", path.display())),
            Err(_) => {}
        }
    }
    if extension_id.is_some() {
        // Finish durable cleanup before considering a newer package for the same ID.
        // Return one recovery task; the coordinator rescans after completing it.
        recovered.sort_by(|a, b| a.id.cmp(&b.id));
        if let Some(task) = recovered.iter().find(|task| task.committed) {
            let _ownership = operation.map(|(state, window, token)| lock_owner(state, window, token)).transpose()?;
            result.tasks.push(task.id.clone());
            return Ok(result);
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
        if let Some(selected) = extension_id {
            let matches = plain(&path).and_then(|_| {
                let manifest = path.join("manifest.json");
                plain(&manifest)?;
                let metadata = fs::metadata(&manifest).map_err(|e| e.to_string())?;
                if metadata.len() > 1024 * 1024 {
                    return Err("Manifest is too large".into());
                }
                let value: serde_json::Value = serde_json::from_slice(&fs::read(&manifest).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                Ok(value.get("id").and_then(|id| id.as_str()) == Some(selected))
            });
            match matches {
                Ok(false) => continue,
                Ok(true) => {}
                Err(_) => continue,
            }
        }
        if candidates.len() >= 128 {
            result.errors.push("At most 128 input packages are processed per startup".into());
            break;
        }
        match tree(&path).and_then(|snapshot| Ok((manifest_id(&snapshot)?, snapshot))) {
            Ok((id, snapshot)) => {
                if extension_id.is_some_and(|selected| selected != id) {
                    continue;
                }
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
    // Hold the ownership lock through synchronous claims; window close cannot release
    // the reservation between this check and a source rename.
    let _ownership = operation.map(|(state, window, token)| lock_owner(state, window, token)).transpose()?;
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
pub(crate) async fn extension_inbox_prepare(
    window: tauri::Window, task_id: String, operation_id: String,
) -> Result<PreparedTask> {
    let (root, mut task, source, package_path) = {
        let (inbox, processing) = roots(&window)?;
        let state = window.state::<InboxState>();
        let _ownership = lock_owner(&state, window.label(), &operation_id)?;
        {
            let state = window.state::<InboxState>();
            let mut active = state.active.lock().map_err(|e| e.to_string())?;
            if active.is_some() {
                return Err("Another startup import is active".into());
            }
            *active = Some(task_id.clone());
        }
        let root = task_root(&processing, &task_id)?;
        let task = load(&root)?;
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
        }
        (root, task, source, package_path)
    };
    if task.package.is_none() {
        let state = window.state::<InboxState>();
        let staged = crate::legacy_extensions::importer::prepare_startup_package(window.clone(), &source, || {
            lock_owner(&state, window.label(), &operation_id)
        })
        .await?;
        // Remote preparation can outlive its window; never mutate a recovered task
        // after a different operation has acquired ownership.
        let _ownership = lock_owner(&state, window.label(), &operation_id)?;
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
    let state = window.state::<InboxState>();
    let _ownership = lock_owner(&state, window.label(), &operation_id)?;
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
pub(crate) fn extension_inbox_complete(window: tauri::Window, task_id: String, operation_id: String) -> Result<()> {
    let (_, processing) = roots(&window)?;
    let state = window.state::<InboxState>();
    let _ownership = lock_owner(&state, window.label(), &operation_id)?;
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
pub(crate) fn extension_inbox_failed(
    window: tauri::Window, task_id: String, message: String, operation_id: String,
) -> Result<()> {
    let (_, processing) = roots(&window)?;
    let state = window.state::<InboxState>();
    let _ownership = lock_owner(&state, window.label(), &operation_id)?;
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
