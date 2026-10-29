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
    // Native window notifications may arrive before setup has installed DriveState.
    app.try_state::<crate::drive::DriveState>().is_some_and(|state| state.is_closing())
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
