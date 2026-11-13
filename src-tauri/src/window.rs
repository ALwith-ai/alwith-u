//! Window helpers ported from ALwith Desktop's `app/native.rs`.

use tauri::Manager;

/// Every explicit main-window open cancels the pending login-launch exit.
#[tauri3_specta::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    ensure_open(&app)?;
    app.state::<crate::autostart::LoginLaunch>().finish();
    let window = app.get_webview_window("main").expect("main window is retained for the application lifetime");
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn is_closing(app: &tauri::AppHandle) -> bool {
    // Native window notifications may arrive before the Drive plugin has installed its state.
    app.try_state::<alwith_drive::Drive>().is_some_and(|state| state.is_closing())
        || app.state::<crate::runtime::RuntimeState>().is_closing()
}

pub fn ensure_open(app: &tauri::AppHandle) -> Result<(), String> {
    if is_closing(app) {
        return Err("Application is closing".into());
    }
    Ok(())
}

/// Makes `label` a child window of `main` (macOS only): it floats above the main window,
/// follows it between Spaces and never becomes its own Stage Manager stage. Called on every
/// open: hiding a child window (orderOut) detaches it, so reopening must re-attach.
/// Other platforms have no such grouping; the command is a no-op there.
#[tauri3_specta::command]
pub fn attach_window_to_main(app: tauri::AppHandle, label: String) -> Result<bool, String> {
    ensure_open(&app)?;
    #[cfg(target_os = "macos")]
    {
        let Some(child) = app.get_webview_window(&label) else {
            return Ok(false);
        };
        let Some(main) = app.get_webview_window("main") else {
            return Ok(false);
        };
        let child_for_ptr = child.clone();
        child
            .run_on_main_thread(move || {
                use objc2_app_kit::{NSWindow, NSWindowOrderingMode};
                if is_closing(child_for_ptr.app_handle()) {
                    return;
                }
                // ns_window() must be called on the main thread.
                let (Ok(child_ptr), Ok(main_ptr)) = (child_for_ptr.ns_window(), main.ns_window()) else {
                    return;
                };
                // SAFETY: both pointers are live NSWindows owned by Tauri; this runs on the main thread.
                let child_ns: &NSWindow = unsafe { &*(child_ptr as *const NSWindow) };
                let main_ns: &NSWindow = unsafe { &*(main_ptr as *const NSWindow) };
                // AppKit coordinates are logical points; do not mix monitor pixel scales.
                // Reposition on every open so a detached tool window follows its parent screen.
                if label == "settings" {
                    let parent = main_ns.frame();
                    let mut frame = child_ns.frame();
                    let screen = main_ns.screen().expect("main window belongs to a screen");
                    let visible = screen.visibleFrame();
                    frame.size.width = frame.size.width.min(visible.size.width);
                    frame.size.height = frame.size.height.min(visible.size.height);
                    frame.origin.x = (parent.origin.x + (parent.size.width - frame.size.width) / 2.0)
                        .clamp(visible.origin.x, visible.origin.x + visible.size.width - frame.size.width);
                    frame.origin.y = (parent.origin.y + (parent.size.height - frame.size.height) / 2.0)
                        .clamp(visible.origin.y, visible.origin.y + visible.size.height - frame.size.height);
                    child_ns.setFrame_display(frame, true);
                }
                // Attach first (an orderedOut child is ordered above its parent = shown), then focus.
                unsafe {
                    main_ns.addChildWindow_ordered(child_ns, NSWindowOrderingMode::Above);
                    child_ns.makeKeyAndOrderFront(None);
                }
            })
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (&app, &label);
    Ok(true)
}

/// Fit initial or restored geometry to the monitor's usable area without resetting valid placement.
pub fn initialize_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = app.get_webview_window("main").expect("main window exists at setup");
    let monitor = window.current_monitor()?.or(window.primary_monitor()?).expect("main window has a monitor");
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let available_width = area.size.width.saturating_sub(outer.width.saturating_sub(inner.width)).max(1);
    let available_height = area.size.height.saturating_sub(outer.height.saturating_sub(inner.height)).max(1);
    window.set_min_size(Some(tauri::LogicalSize::new(
        960.0_f64.min(available_width as f64 / scale),
        640.0_f64.min(available_height as f64 / scale),
    )))?;
    if !window.is_maximized()? && !window.is_fullscreen()? {
        let fitted = tauri::PhysicalSize::new(inner.width.min(available_width), inner.height.min(available_height));
        if fitted != inner {
            window.set_size(fitted)?;
        }
        let outer = window.outer_size()?;
        let position = window.outer_position()?;
        let x = position.x.clamp(area.position.x, area.position.x + area.size.width.saturating_sub(outer.width) as i32);
        let y =
            position.y.clamp(area.position.y, area.position.y + area.size.height.saturating_sub(outer.height) as i32);
        if x != position.x || y != position.y {
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
    }
    Ok(())
}
