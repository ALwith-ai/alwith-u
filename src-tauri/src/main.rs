// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = alwith_u_lib::run_extension_cli() {
        std::process::exit(code);
    }
    alwith_u_lib::run();
}
