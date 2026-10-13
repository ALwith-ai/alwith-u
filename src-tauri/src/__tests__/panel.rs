use super::{is_overlay, set_presented, should_restore, with_restored_responder};
use std::cell::Cell;

#[test]
fn environment_repairs_keep_pet_visibility_intent_without_reopening_hidden_bubbles() {
    set_presented("vibemon", true);
    set_presented("bubble-menu-vibemon", false);
    assert!(should_restore("vibemon", false));
    assert!(!should_restore("bubble-menu-vibemon", true));
    set_presented("bubble-menu-vibemon", true);
    assert!(should_restore("bubble-menu-vibemon", false));
    set_presented("vibemon", false);
    set_presented("bubble-menu-vibemon", false);
    assert!(!should_restore("vibemon", false));
    assert!(!should_restore("bubble-menu-vibemon", false));
    assert!(should_restore("chat", true));
    assert!(!should_restore("chat", false));
}

#[test]
fn only_owned_overlays_participate_in_panel_lifecycle() {
    for label in ["chat", "vibemon", "bubble-menu-vibemon"] {
        assert!(is_overlay(label));
    }
    for label in ["main", "settings", ""] {
        assert!(!is_overlay(label));
        assert!(!should_restore(label, true));
    }
}

#[test]
fn rejected_style_changes_restore_input_and_return_the_system_error() {
    let restored = Cell::new(false);
    let error = tauri_nspanel::StyleMaskError::ObjectiveCException("rejected style".into()).to_string();
    let result = with_restored_responder(
        || Err(error.clone()),
        || {
            restored.set(true);
            true
        },
    );
    assert!(restored.get());
    assert_eq!(result, Err(error));
}

#[test]
fn responder_failure_is_returned_instead_of_panicking() {
    assert_eq!(with_restored_responder(|| Ok(()), || false), Err("Failed to restore overlay input responder".into()));
    assert_eq!(with_restored_responder(|| Ok(()), || true), Ok(()));
}
