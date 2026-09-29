pub(crate) mod files;
pub(crate) mod http;
pub(crate) mod importer;

use tauri::Manager;

const MAX_BYTES: usize = 64 * 1024 * 1024;

fn require_installation(window: &tauri::Window, extension_id: &str) -> Result<(), String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Only extension host windows can use legacy extension capabilities".into());
    }
    if !matches!(extension_id, "bi-metrics" | "yup-kb" | "etms-strategy-review") {
        return Err("This legacy extension is not certified".into());
    }
    importer::require_legacy_installation(window.app_handle(), extension_id)
}
