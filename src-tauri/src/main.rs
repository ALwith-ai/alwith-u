// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg_attr(feature = "runtime-cef", tauri_runtime_cef::cef_entry_point)]
fn main() {
    alwith_u_lib::run();
}
