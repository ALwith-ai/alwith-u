use super::{BackdropPathCommand, WindowAction, validate};
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
