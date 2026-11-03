//! Native library directories of development builds. Module plugins load their own libraries; a
//! release build finds them among the bundled resources.
use std::path::PathBuf;

/// The staged native libraries of a development build; release builds use the bundled resources.
pub fn development_directory() -> Option<PathBuf> {
    cfg!(debug_assertions).then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native"))
}

/// The staged resource directory of a development build; release builds use the bundled resources.
pub fn development_resources() -> Option<PathBuf> {
    tauri::is_dev().then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"))
}
