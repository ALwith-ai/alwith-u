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
                let _ = sender.send(initialize(&handle));
            })
            .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    window.set_always_on_top(true).map_err(|error| error.to_string())?;
    Ok(())
}

// Do not set is_floating_panel: Tao 0.35.3 uses level 5 to both set and query always-on-top,
// while AppKit setFloatingPanel changes it to 3, making Tauri's query disagree with the actual policy.
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(DesktopChatPanel {
        config: {
            can_become_key_window: true,
            // Preserve the chat panel's menu shortcut validation; style bits enforce nonactivation.
            can_become_main_window: true,
            hides_on_deactivate: false
        }
    })
}

#[cfg(target_os = "macos")]
fn initialize(window: &WebviewWindow) -> Result<(), String> {
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindow};
    use tauri_nspanel::WebviewWindowExt;

    objc2::MainThreadMarker::new().expect("Overlay initialization requires the main thread");
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: This is a live Tauri window accessed on the main thread. Reacquire the reference after conversion.
    let native = unsafe { &*(pointer as *const NSWindow) };
    let first_responder = native.firstResponder();
    if !native.isKindOfClass(NSPanel::class()) {
        // Unregister WKWebView KVO before changing the class; never overwrite a dynamic subclass created by an observer.
        // Never change an already converted window's class again: doing so breaks TouchBar KVO registered after it becomes key.
        let content = native.contentView().expect("Overlay must have a content view");
        let views = content.subviews();
        for view in views.iter() {
            view.removeFromSuperview();
        }
        window.to_panel::<DesktopChatPanel>().expect("Failed to create desktop chat panel");
        for view in views.iter() {
            content.addSubview(&view);
        }
    }
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: This is the same live window, class conversion has finished, and access is still on the main thread.
    let native = unsafe { &*(pointer as *const NSWindow) };
    restore(native);
    // Detaching and reattaching WKWebView resets the responder; restore the original input target without changing the window's key status.
    assert!(native.makeFirstResponder(first_responder.as_deref()), "Failed to restore overlay input responder");
    Ok(())
}

/// Restore properties only, without showing, moving, or stealing focus; safe for Space changes and wake events.
#[cfg(target_os = "macos")]
pub fn restore(window: &objc2_app_kit::NSWindow) {
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindowCollectionBehavior as Behavior, NSWindowStyleMask};

    objc2::MainThreadMarker::new().expect("Overlay policy requires the main thread");
    assert!(window.isKindOfClass(NSPanel::class()), "Overlay must be initialized before display");
    let style = window.styleMask() | NSWindowStyleMask::NonactivatingPanel;
    if window.styleMask() != style {
        let first_responder = window.firstResponder();
        window.setStyleMask(style);
        // Match Tao's toggle_style_mask: restore the keyboard responder chain after changing styles.
        assert!(
            window.makeFirstResponder(first_responder.as_deref()),
            "Failed to restore overlay input responder after style change"
        );
    }
    let conflicts = Behavior::Managed
        | Behavior::Transient
        | Behavior::MoveToActiveSpace
        | Behavior::Primary
        | Behavior::Auxiliary
        | Behavior::FullScreenPrimary
        | Behavior::FullScreenNone
        | Behavior::FullScreenAllowsTiling;
    let behavior = (window.collectionBehavior() & !conflicts)
        | Behavior::Stationary
        | Behavior::CanJoinAllSpaces
        | Behavior::CanJoinAllApplications
        | Behavior::FullScreenAuxiliary
        | Behavior::FullScreenDisallowsTiling;
    if window.collectionBehavior() != behavior {
        window.setCollectionBehavior(behavior);
    }
    // Stay consistent with the current Tao set_always_on_top / is_always_on_top implementation.
    const TOPMOST_LEVEL: isize = 5;
    if window.level() != TOPMOST_LEVEL {
        window.setLevel(TOPMOST_LEVEL);
    }
}
