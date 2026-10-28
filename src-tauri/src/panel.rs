//! U-owned macOS panel lifecycle shared by chat, pet, and bubble windows.
use std::{cell::RefCell, collections::HashSet};
use tauri::{Manager, WebviewWindow};

thread_local! {
    static PRESENTED_PETS: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

pub fn set_presented(label: &str, visible: bool) {
    PRESENTED_PETS.with_borrow_mut(|windows| {
        if visible {
            windows.insert(label.to_owned());
        } else {
            windows.remove(label);
        }
    });
}

pub fn should_restore(label: &str, visible: bool) -> bool {
    match label {
        "chat" => visible,
        "vibemon" | "bubble-menu-vibemon" => PRESENTED_PETS.with_borrow(|windows| windows.contains(label)),
        _ => false,
    }
}

pub fn is_overlay(label: &str) -> bool {
    matches!(label, "chat" | "vibemon" | "bubble-menu-vibemon")
}

pub fn is_input_panel(window: &objc2_app_kit::NSWindow) -> bool {
    use objc2::ClassType;
    window.isKindOfClass(RawDesktopChatPanel::class()) || window.isKindOfClass(RawPetBubblePanel::class())
}

pub fn closed(app: &tauri::AppHandle, label: &str) {
    use tauri_nspanel::ManagerExt;
    set_presented(label, false);
    if let Some(panel) = app.remove_webview_panel(label) {
        crate::vibemon::window::forget_backdrop(panel.as_panel() as *const _ as usize);
    }
}

// Do not set is_floating_panel: Tao uses level 5 to both set and query always-on-top,
// while AppKit setFloatingPanel changes it to 3, making Tauri's query disagree with the actual policy.
tauri_nspanel::tauri_panel! {
    panel!(DesktopChatPanel {
        config: {
            can_become_key_window: true,
            // Preserve the chat panel's menu shortcut validation; style bits enforce nonactivation.
            can_become_main_window: true,
            hides_on_deactivate: false
        }
    })
    panel!(PetPanel {
        config: {
            can_become_key_window: false,
            can_become_main_window: false,
            hides_on_deactivate: false
        }
    })
    panel!(PetBubblePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            hides_on_deactivate: false
        }
    })
}

pub fn prepare(window: &WebviewWindow) -> Result<(), String> {
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindow};
    use tauri_nspanel::WebviewWindowExt;

    objc2::MainThreadMarker::new().expect("Overlay initialization requires the main thread");
    if !is_overlay(window.label()) {
        return Err(format!("Window {} is not an overlay", window.label()));
    }
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
        let converted = match window.label() {
            "chat" => window.to_panel::<DesktopChatPanel>(),
            "vibemon" => window.to_panel::<PetPanel>(),
            "bubble-menu-vibemon" => window.to_panel::<PetBubblePanel>(),
            _ => unreachable!("validated overlay label"),
        };
        for view in views.iter() {
            content.addSubview(&view);
        }
        converted.map_err(|error| error.to_string())?;
    }
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: This is the same live window, class conversion has finished, and access is still on the main thread.
    let native = unsafe { &*(pointer as *const NSWindow) };
    // Conversion runs with WebKit detached for KVO safety. Install IME support only after reattachment.
    let content = native.contentView().expect("Overlay must have a content view");
    tauri_nspanel::panel::install_text_input_client_window_level(&content);
    // Detaching and reattaching WKWebView resets the responder; restore the original input target without changing the window's key status.
    with_restored_responder(|| restore(window), || native.makeFirstResponder(first_responder.as_deref()))
}

fn with_restored_responder(
    operation: impl FnOnce() -> Result<(), String>, restore_responder: impl FnOnce() -> bool,
) -> Result<(), String> {
    let result = operation();
    // A rejected style change may already have disturbed the responder chain.
    let restored = restore_responder();
    result?;
    if !restored {
        return Err("Failed to restore overlay input responder".into());
    }
    Ok(())
}

/// Restore properties only, without showing, moving, or stealing focus; safe for Space changes and wake events.
pub fn restore(window: &WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSWindowCollectionBehavior as Behavior, NSWindowStyleMask};
    use tauri_nspanel::ManagerExt;

    objc2::MainThreadMarker::new().expect("Overlay policy requires the main thread");
    let panel =
        window.app_handle().get_webview_panel(window.label()).expect("Overlay must be initialized before display");
    let is_pet = window.label() == "vibemon";
    let window = panel.as_panel();
    window.setAcceptsMouseMovedEvents(true);
    {
        let first_responder = window.firstResponder();
        // Go through nspanel: a bare setStyleMask does not sync WindowServer's activation-prevention tag.
        // Match Tao's toggle_style_mask: restore the keyboard responder chain after changing styles.
        with_restored_responder(
            || panel.add_style_mask(NSWindowStyleMask::NonactivatingPanel).map_err(|error| error.to_string()),
            || window.makeFirstResponder(first_responder.as_deref()),
        )?;
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
    if is_pet {
        use objc2::{msg_send, sel};
        use objc2_foundation::NSObjectProtocol;
        // SAFETY: optional AppKit selector, called on its main thread.
        unsafe {
            if window.respondsToSelector(sel!(_setCanTile:)) {
                let _: () = msg_send![window, _setCanTile: false];
            }
        }
    }
    // Stay consistent with the current Tao set_always_on_top / is_always_on_top implementation.
    const TOPMOST_LEVEL: isize = 5;
    if window.level() != TOPMOST_LEVEL {
        window.setLevel(TOPMOST_LEVEL);
    }
    Ok(())
}

#[cfg(test)]
#[path = "__tests__/panel.rs"]
mod tests;
