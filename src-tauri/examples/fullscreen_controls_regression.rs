//! Run AppKit control regressions on the actual main thread, without application data.
#[cfg(target_os = "macos")]
#[path = "../src/fullscreen_controls.rs"]
mod controls;
#[cfg(target_os = "macos")]
#[path = "../src/__tests__/fullscreen_controls.rs"]
mod regression;

fn main() {
    #[cfg(target_os = "macos")]
    regression::run();
    #[cfg(not(target_os = "macos"))]
    eprintln!("This regression requires macOS AppKit.");
}
