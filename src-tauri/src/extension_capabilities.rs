//! Host authorization for optional capabilities shared by modern and legacy extensions.
use alwith_extension::{Installation, Snapshot};
use tauri::Manager;

fn selected_installation(snapshot: Snapshot, window: &str, id: &str) -> Result<Installation, String> {
    if !matches!(window, "main" | "settings") {
        return Err("Only extension host windows can use extension capabilities".into());
    }
    if snapshot.pending.iter().any(|pending| pending.id == id) {
        return Err("Extension is transitioning".into());
    }
    snapshot
        .installations
        .into_iter()
        .find(|item| item.id == id && item.enabled)
        .ok_or_else(|| "Extension is not installed or enabled".into())
}

pub(crate) fn require_installation(window: &tauri::Window, id: &str) -> Result<Installation, String> {
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|error| error.to_string())?;
    selected_installation(snapshot, window.label(), id)
}

fn require_removed(snapshot: &Snapshot, id: &str) -> Result<(), String> {
    if snapshot.installations.iter().any(|item| item.id == id) || snapshot.pending.iter().any(|item| item.id == id) {
        return Err("Extension uninstall must finish before clearing directory grants".into());
    }
    Ok(())
}

#[tauri3_specta::command]
pub async fn extension_cleanup_grants(window: tauri::Window, extension_id: String) -> Result<(), String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Only extension host windows can clear directory grants".into());
    }
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|error| error.to_string())?;
    require_removed(&snapshot, &extension_id)?;
    crate::legacy_extensions::files::clear_grants(window.app_handle(), &extension_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alwith_extension::{PendingTransition, TransitionAction};

    fn snapshot() -> Snapshot {
        serde_json::from_value(serde_json::json!({
            "serviceId":"test", "protocolVersion":1, "sequence":0, "pending":[],
            "installations":[{
                "id":"notes", "manifest":{
                    "manifestVersion":3, "id":"notes", "name":"Notes", "version":"1.0.0",
                    "dependencies":{"@alwith/module-extension":"^0.1.5"}
                }, "source":"local", "installationId":"install", "packageRevision":"revision",
                "dataGeneration":1, "enabled":true
            }]
        }))
        .unwrap()
    }

    #[test]
    fn grants_are_cleared_only_after_uninstall_finishes() {
        let mut state = snapshot();
        assert!(require_removed(&state, "notes").is_err());
        state.installations.clear();
        state.pending.push(PendingTransition {
            id: "notes".into(),
            action: TransitionAction::Uninstall,
            waiting_instances: 1,
        });
        assert!(require_removed(&state, "notes").is_err());
        state.pending.clear();
        assert!(require_removed(&state, "notes").is_ok());
    }

    #[test]
    fn only_enabled_settled_extensions_in_host_windows_are_authorized() {
        assert_eq!(selected_installation(snapshot(), "main", "notes").unwrap().source, "local");
        assert!(selected_installation(snapshot(), "settings", "notes").is_ok());
        assert!(selected_installation(snapshot(), "overlay", "notes").is_err());
        assert!(selected_installation(snapshot(), "main", "other").is_err());
        let mut disabled = snapshot();
        disabled.installations[0].enabled = false;
        assert!(selected_installation(disabled, "main", "notes").is_err());
        let mut pending = snapshot();
        pending.pending.push(PendingTransition {
            id: "notes".into(),
            action: TransitionAction::Update,
            waiting_instances: 1,
        });
        assert!(selected_installation(pending, "main", "notes").is_err());
    }
}
