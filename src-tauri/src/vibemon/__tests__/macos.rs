use super::{bubble_frame, offscreen_origin};
use objc2_foundation::{NSPoint, NSRect, NSSize};

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

#[test]
fn mixed_dpi_offscreen_placement_returns_to_the_active_work_area() {
    let retina = rect(0.0, 0.0, 1680.0, 1019.0);
    let external = rect(1680.0, 0.0, 2560.0, 1409.0);
    let misplaced = rect(3136.0, -960.0, 200.0, 200.0);
    assert_eq!(offscreen_origin(misplaced, &[retina, external], external), Some(NSPoint::new(4016.0, 90.0)));
}

#[test]
fn a_pet_on_another_display_keeps_its_position() {
    let primary = rect(0.0, 0.0, 1680.0, 1019.0);
    let secondary = rect(1680.0, 0.0, 2560.0, 1409.0);
    assert_eq!(offscreen_origin(rect(3000.0, 400.0, 200.0, 200.0), &[primary, secondary], primary), None);
}

#[test]
fn negative_display_origins_are_valid_and_disconnected_positions_are_repaired() {
    let primary = rect(0.0, 40.0, 1680.0, 979.0);
    let left = rect(-1920.0, -80.0, 1920.0, 1000.0);
    let frame = rect(-600.0, 200.0, 200.0, 200.0);
    assert_eq!(offscreen_origin(frame, &[primary, left], primary), None);
    assert_eq!(offscreen_origin(frame, &[primary], primary), Some(NSPoint::new(1456.0, 130.0)));
}

#[test]
fn bubble_reflows_at_the_edge_of_a_smaller_display() {
    let pet = rect(1080.0, 100.0, 200.0, 200.0);
    let bubble = NSSize::new(320.0, 220.0);
    assert_eq!(bubble_frame(pet, bubble, rect(0.0, 0.0, 1920.0, 1080.0)), rect(1020.0, 300.0, 320.0, 220.0));
    assert_eq!(bubble_frame(pet, bubble, rect(0.0, 0.0, 1280.0, 720.0)), rect(960.0, 300.0, 320.0, 220.0));
}

#[test]
fn bubble_switches_below_the_pet_when_the_new_screen_has_no_room_above() {
    let pet = rect(500.0, 400.0, 200.0, 200.0);
    let bubble = NSSize::new(320.0, 220.0);
    assert_eq!(bubble_frame(pet, bubble, rect(0.0, 0.0, 1280.0, 1080.0)), rect(440.0, 600.0, 320.0, 220.0));
    assert_eq!(bubble_frame(pet, bubble, rect(0.0, 0.0, 1280.0, 720.0)), rect(440.0, 180.0, 320.0, 220.0));
}

#[test]
fn bubble_layout_uses_global_points_on_displays_with_negative_origins() {
    let screen = rect(-1280.0, -100.0, 1280.0, 720.0);
    let pet = rect(-1280.0, 420.0, 200.0, 200.0);
    assert_eq!(bubble_frame(pet, NSSize::new(320.0, 220.0), screen), rect(-1280.0, 200.0, 320.0, 220.0));
}

#[test]
fn bubble_clamps_when_neither_side_of_the_pet_has_enough_height() {
    let screen = rect(0.0, 40.0, 800.0, 500.0);
    assert_eq!(
        bubble_frame(rect(200.0, 140.0, 200.0, 200.0), NSSize::new(320.0, 400.0), screen),
        rect(140.0, 40.0, 320.0, 400.0)
    );
}
