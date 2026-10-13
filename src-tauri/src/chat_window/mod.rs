//! Chat window policy adapted from Desktop; extraction candidates: .docs/modules.md.
use tauri::{Manager, WebviewWindow};
#[cfg(target_os = "macos")]
mod ime_candidates;
pub mod plugin;
mod resize;
pub use plugin::init;

pub fn is_overlay(label: &str) -> bool {
    label == "chat"
}
#[cfg(target_os = "macos")]
pub fn install_input_observer() {
    ime_candidates::install();
}
#[cfg(target_os = "macos")]
pub fn update_input_candidates() {
    ime_candidates::update();
}

/// Callers must wait for initialization to finish before showing or focusing the window.
pub async fn prepare(window: &WebviewWindow) -> Result<(), String> {
    if !is_overlay(window.label()) {
        return Err(format!("Window {} is not an overlay", window.label()));
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let handle = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(crate::panel::prepare(&handle));
            })
            .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    window.set_always_on_top(true).map_err(|error| error.to_string())?;
    Ok(())
}
