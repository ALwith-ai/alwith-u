use super::{BackdropPathCommand, WindowAction, validate};

#[test]
fn lounge_can_play_the_handoff_sound_without_overlay_window_controls() {
    for label in ["main", "chat"] {
        assert!(super::allows_action(label, "sound"));
        for action in ["present", "hide", "drag", "focus"] {
            assert!(!super::allows_action(label, action));
        }
    }
    assert!(!super::allows_action("settings", "sound"));
    assert!(super::allows_action("vibemon", "sound"));
}

fn action(value: serde_json::Value) -> WindowAction {
    serde_json::from_value(value).unwrap()
}
#[test]
fn backdrop_rejects_invalid_radius_role_and_nonfinite_coordinates() {
    let mut backdrop = action(
        serde_json::json!({"action":"blur","handle":1,"role":"bubble","radius":20,"path":[{"kind":"move","x":0,"y":0},{"kind":"close"}]}),
    );
    assert!(validate(&backdrop).is_ok());
    backdrop.radius = Some(0);
    assert!(validate(&backdrop).is_ok());
    backdrop.radius = Some(21);
    assert!(validate(&backdrop).is_err());
    backdrop.radius = None;
    assert!(validate(&backdrop).is_err());
    backdrop.radius = Some(20);
    backdrop.role = "pet".into();
    assert!(validate(&backdrop).is_err());
    backdrop.role = "bubble".into();
    backdrop.path = Some(vec![BackdropPathCommand::Line { x: f64::NAN, y: 0. }]);
    assert!(validate(&backdrop).is_err());
    backdrop.path = None;
    assert!(validate(&backdrop).is_ok());
}
#[test]
fn bubble_resize_requires_paired_finite_dimensions() {
    let mut resize = action(serde_json::json!({"action":"bubble","handle":1,"role":"bubble","width":338,"height":320}));
    assert!(validate(&resize).is_ok());
    resize.height = None;
    assert!(validate(&resize).is_err());
    resize.height = Some(320.);
    resize.width = Some(f64::INFINITY);
    assert!(validate(&resize).is_err());
    resize.width = Some(338.);
    resize.height = Some(0.);
    assert!(validate(&resize).is_err());
}
