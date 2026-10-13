//! Runs the macOS WebKit protocol regression on the actual main thread.

#[cfg(target_os = "macos")]
#[path = "../src/__tests__/wry_protocol.rs"]
mod regression;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    regression::run()?;
    #[cfg(not(target_os = "macos"))]
    eprintln!("This regression requires macOS WebKit.");
    Ok(())
}
