use super::*;

const DEV: Option<(f64, f64)> = Some((160.0, 115.0));

const SPREAD: f64 = 0.2;

fn frame(touching: usize, cancelled: usize, centroid: (f64, f64), ts: f64) -> TouchFrame {
    TouchFrame { touching, cancelled, centroid, spread: SPREAD, ts, device: DEV }
}

fn frame_spread(touching: usize, centroid: (f64, f64), spread: f64, ts: f64) -> TouchFrame {
    TouchFrame { touching, cancelled: 0, centroid, spread, ts, device: DEV }
}

#[test]
fn began_changed_ended_flow() {
    let mut m = Machine::new();
    assert!(m.step(&frame(3, 0, (0.5, 0.5), 0.00)).is_none());
    let began = m.step(&frame(3, 0, (0.5, 0.5), 0.01)).expect("expected gesture transition");
    assert_eq!(began.phase, TrackpadGesturePhase::Began);
    assert_eq!(began.fingers, 3);
    assert_eq!((began.dx, began.dy), (0.0, 0.0));
    assert_eq!((began.device_w, began.device_h), (Some(160.0), Some(115.0)));

    let changed = m.step(&frame(3, 0, (0.6, 0.5), 0.02)).expect("expected gesture transition");
    assert_eq!(changed.phase, TrackpadGesturePhase::Changed);
    assert!((changed.dx - 0.1).abs() < 1e-9);
    assert_eq!(changed.dy, 0.0);
    assert!((changed.total_dx - 0.1).abs() < 1e-9);
    assert_eq!(changed.device_w, None);

    let ended = m.step(&frame(0, 0, (0.0, 0.0), 0.03)).expect("expected gesture transition");
    assert_eq!(ended.phase, TrackpadGesturePhase::Ended);
    assert!((ended.total_dx - 0.1).abs() < 1e-9);
    assert_eq!((ended.dx, ended.dy), (0.0, 0.0));
}

#[test]
fn four_finger_staggered_start_debounced() {
    let mut m = Machine::new();
    assert!(m.step(&frame(3, 0, (0.5, 0.5), 0.00)).is_none());
    assert!(m.step(&frame(4, 0, (0.5, 0.5), 0.01)).is_none());
    let began = m.step(&frame(4, 0, (0.5, 0.5), 0.02)).expect("expected gesture transition");
    assert_eq!(began.phase, TrackpadGesturePhase::Began);
    assert_eq!(began.fingers, 4);
}

#[test]
fn arming_move_triggers_began() {
    let mut m = Machine::new();
    assert!(m.step(&frame(3, 0, (0.5, 0.5), 0.00)).is_none());
    let began = m.step(&frame(3, 0, (0.52, 0.5), 0.01)).expect("expected gesture transition");
    assert_eq!(began.phase, TrackpadGesturePhase::Began);
}

#[test]
fn finger_count_change_reopens_gesture() {
    let mut m = Machine::new();
    m.step(&frame(4, 0, (0.5, 0.5), 0.00));
    m.step(&frame(4, 0, (0.5, 0.5), 0.01));
    let ended = m.step(&frame(3, 0, (0.5, 0.5), 0.02)).expect("expected gesture transition");
    assert_eq!(ended.phase, TrackpadGesturePhase::Ended);
    assert_eq!(ended.fingers, 4);
    let began = m.step(&frame(3, 0, (0.5, 0.5), 0.03)).expect("expected gesture transition");
    assert_eq!(began.phase, TrackpadGesturePhase::Began);
    assert_eq!(began.fingers, 3);
}

#[test]
fn cancelled_by_system_gesture() {
    let mut m = Machine::new();
    m.step(&frame(3, 0, (0.5, 0.5), 0.00));
    m.step(&frame(3, 0, (0.5, 0.5), 0.01));
    let cancelled = m.step(&frame(0, 3, (0.0, 0.0), 0.02)).expect("expected gesture transition");
    assert_eq!(cancelled.phase, TrackpadGesturePhase::Cancelled);

    let mut m2 = Machine::new();
    assert!(m2.step(&frame(3, 0, (0.5, 0.5), 0.00)).is_none());
    assert!(m2.step(&frame(0, 3, (0.0, 0.0), 0.01)).is_none());
    assert!(m2.step(&frame(3, 0, (0.5, 0.5), 0.02)).is_none());
}

#[test]
fn below_three_fingers_ignored() {
    let mut m = Machine::new();
    assert!(m.step(&frame(2, 0, (0.5, 0.5), 0.00)).is_none());
    assert!(m.step(&frame(2, 0, (0.6, 0.5), 0.01)).is_none());
    assert!(m.step(&frame(0, 2, (0.0, 0.0), 0.02)).is_none());
}

#[test]
fn pinch_reports_spread_delta() {
    let mut m = Machine::new();
    assert!(m.step(&frame_spread(3, (0.5, 0.5), 0.20, 0.00)).is_none());
    let began = m.step(&frame_spread(3, (0.5, 0.5), 0.20, 0.01)).expect("began");
    assert_eq!((began.d_spread, began.total_d_spread), (0.0, 0.0));

    let pinch = m.step(&frame_spread(3, (0.5, 0.5), 0.15, 0.02)).expect("expected gesture transition");
    assert!((pinch.d_spread + 0.05).abs() < 1e-9);
    assert_eq!((pinch.dx, pinch.dy), (0.0, 0.0));

    let open = m.step(&frame_spread(3, (0.5, 0.5), 0.18, 0.03)).expect("expected gesture transition");
    assert!((open.d_spread - 0.03).abs() < 1e-9);
    assert!((open.total_d_spread + 0.02).abs() < 1e-9);

    let ended = m.step(&frame(0, 0, (0.0, 0.0), 0.04)).expect("ended");
    assert_eq!(ended.d_spread, 0.0);
    assert!((ended.total_d_spread + 0.02).abs() < 1e-9);
}

#[test]
fn tap_like_short_sequence() {
    let mut m = Machine::new();
    m.step(&frame(3, 0, (0.5, 0.5), 0.00));
    let began = m.step(&frame(3, 0, (0.5, 0.5), 0.01)).expect("began");
    let ended = m.step(&frame(0, 0, (0.0, 0.0), 0.05)).expect("ended");
    assert_eq!(ended.phase, TrackpadGesturePhase::Ended);
    assert_eq!((ended.total_dx, ended.total_dy), (0.0, 0.0));
    assert!(ended.ts - began.ts < 0.1);
}

#[test]
fn aggregate_centroid_and_spread() {
    let ((cx, cy), spread) = aggregate(&[(0.4, 0.5), (0.6, 0.5)]);
    assert!((cx - 0.5).abs() < 1e-9);
    assert!((cy - 0.5).abs() < 1e-9);
    assert!((spread - 0.1).abs() < 1e-9);
}

fn entry(tip: bool, x: f64) -> TouchEntry {
    TouchEntry { tip, x, y: 0.5 }
}

#[test]
fn assembler_parallel_single_report() {
    let mut a = FrameAssembler::new();
    let out = a.push(3, vec![entry(true, 0.1), entry(true, 0.2), entry(true, 0.3)]);
    assert_eq!(out.expect("expected gesture transition").len(), 3);
}

#[test]
fn assembler_hybrid_two_reports() {
    let mut a = FrameAssembler::new();
    assert!(a.push(4, vec![entry(true, 0.1), entry(true, 0.2), entry(true, 0.3)]).is_none());
    let out = a.push(0, vec![entry(true, 0.4)]).expect("expected gesture transition");
    assert_eq!(out.len(), 4);
    assert_eq!(out[3], entry(true, 0.4));
}

#[test]
fn assembler_truncates_and_ignores_stray() {
    let mut a = FrameAssembler::new();
    let out = a.push(2, vec![entry(true, 0.1), entry(false, 0.2), entry(true, 0.9)]);
    assert_eq!(out.expect("expected gesture transition").len(), 2);
    assert!(a.push(0, vec![entry(true, 0.5)]).is_none());
}

#[test]
fn assembler_new_frame_resets_stale() {
    let mut a = FrameAssembler::new();
    assert!(a.push(4, vec![entry(true, 0.1)]).is_none());
    let out = a.push(2, vec![entry(true, 0.5), entry(true, 0.6)]).expect("expected gesture transition");
    assert_eq!(out.len(), 2);
    assert_eq!(out[0], entry(true, 0.5));
}
