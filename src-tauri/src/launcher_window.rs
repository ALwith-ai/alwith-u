//! The launcher: an overlay summoned from anywhere that takes the keyboard without activating U,
//! so the application in front stays in front and gets the keyboard back when the launcher hides.
use tauri::{Manager, PhysicalPosition, WebviewWindow};

/// The launcher's top edge sits this far down the display under the pointer.
const TOP_FRACTION: f64 = 0.22;

fn require(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "launcher" { Ok(()) } else { Err("Only the launcher window may present itself".into()) }
}

/// Centres the launcher horizontally on the display under the pointer.
fn place(window: &WebviewWindow) -> Result<(), String> {
    let pointer = window.cursor_position().map_err(|error| error.to_string())?;
    let monitor = window
        .monitor_from_point(pointer.x, pointer.y)
        .map_err(|error| error.to_string())?
        .ok_or("No display is under the pointer")?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let area = monitor.size();
    let origin = monitor.position();
    let x = f64::from(origin.x) + (f64::from(area.width) - f64::from(size.width)) / 2.0;
    let y = f64::from(origin.y) + f64::from(area.height) * TOP_FRACTION;
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)).map_err(|error| error.to_string())
}

/// Shows the launcher on the display under the pointer and gives it the keyboard.
#[tauri3_specta::command]
pub async fn present_launcher_window(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    crate::window::ensure_open(window.app_handle())?;
    place(&window)?;
    #[cfg(target_os = "macos")]
    {
        let handle = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    crate::window::ensure_open(handle.app_handle())?;
                    crate::panel::prepare(&handle)?;
                    let pointer = handle.ns_window().map_err(|error| error.to_string())?;
                    // SAFETY: prepared, retained window on AppKit's main thread.
                    let native = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                    native.orderFrontRegardless();
                    native.makeKeyWindow();
                    Ok::<(), String>(())
                })();
                let _ = send.send(result);
            })
            .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.set_always_on_top(true).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Hides the launcher; the application that was in front keeps the keyboard.
#[tauri3_specta::command]
pub async fn dismiss_launcher_window(window: WebviewWindow) -> Result<(), String> {
    require(&window)?;
    window.hide().map_err(|error| error.to_string())
}
