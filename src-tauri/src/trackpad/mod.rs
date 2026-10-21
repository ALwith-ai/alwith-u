//! Native touch acquisition with a platform-independent gesture recognizer.
#![cfg_attr(
    not(any(target_os = "macos", target_os = "windows", test)),
    allow(dead_code, unused_imports, unused_variables)
)]

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use tauri::AppHandle;
use tauri3_specta::Event as _;

#[derive(Clone, Copy, PartialEq, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum TrackpadGesturePhase {
    Began,
    Changed,
    Ended,
    Cancelled,
}

/// Normalized touchpad deltas, with right/down positive axes.
#[derive(Clone, Debug, serde::Serialize, specta::Type, tauri3_specta::Event)]
#[serde(rename_all = "camelCase")]
#[event(name = "trackpad-gesture")]
pub struct TrackpadGesture {
    pub fingers: u32,
    pub phase: TrackpadGesturePhase,
    pub dx: f64,
    pub dy: f64,
    pub total_dx: f64,
    pub total_dy: f64,
    pub d_spread: f64,
    pub total_d_spread: f64,
    pub ts: f64,
    pub device_w: Option<f64>,
    pub device_h: Option<f64>,
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    macos::install(app)?;
    #[cfg(target_os = "windows")]
    windows::install(app)?;
    Ok(())
}

/// Called on the event-loop thread so native state cannot survive a focus change.
pub fn reset() {
    #[cfg(target_os = "macos")]
    macos::reset();
    #[cfg(target_os = "windows")]
    windows::reset();
}

/// One observation in normalized coordinates; cancellation comes from the OS.
struct TouchFrame {
    touching: usize,

    cancelled: usize,

    centroid: (f64, f64),

    spread: f64,
    ts: f64,

    device: Option<(f64, f64)>,
}

const ARMING_STABLE_FRAMES: u32 = 2;
const ARMING_MOVE_EPS: f64 = 0.01;

enum State {
    Idle,
    Arming { fingers: usize, frames: u32, start: (f64, f64) },
    Tracking { fingers: usize, last: (f64, f64), total: (f64, f64), last_spread: f64, total_spread: f64 },
}

struct Machine {
    state: State,
}

impl Machine {
    fn new() -> Self {
        Self { state: State::Idle }
    }

    fn step(&mut self, f: &TouchFrame) -> Option<TrackpadGesture> {
        match self.state {
            State::Idle => {
                if f.cancelled == 0 && f.touching >= 3 {
                    self.state = State::Arming { fingers: f.touching, frames: 1, start: f.centroid };
                }
                None
            }
            State::Arming { fingers, frames, start } => {
                if f.cancelled > 0 || f.touching < 3 {
                    self.state = State::Idle;
                    return None;
                }
                if f.touching != fingers {
                    self.state = State::Arming { fingers: f.touching, frames: 1, start: f.centroid };
                    return None;
                }
                let moved = (f.centroid.0 - start.0).hypot(f.centroid.1 - start.1) > ARMING_MOVE_EPS;
                if frames + 1 >= ARMING_STABLE_FRAMES || moved {
                    self.state = State::Tracking {
                        fingers,
                        last: f.centroid,
                        total: (0.0, 0.0),
                        last_spread: f.spread,
                        total_spread: 0.0,
                    };
                    return Some(gesture(
                        fingers,
                        TrackpadGesturePhase::Began,
                        (0.0, 0.0),
                        (0.0, 0.0),
                        (0.0, 0.0),
                        f.ts,
                        f.device,
                    ));
                }
                self.state = State::Arming { fingers, frames: frames + 1, start };
                None
            }
            State::Tracking { fingers, last, total, last_spread, total_spread } => {
                if f.cancelled > 0 {
                    self.state = State::Idle;
                    return Some(gesture(
                        fingers,
                        TrackpadGesturePhase::Cancelled,
                        (0.0, 0.0),
                        total,
                        (0.0, total_spread),
                        f.ts,
                        None,
                    ));
                }
                if f.touching == 0 {
                    self.state = State::Idle;
                    return Some(gesture(
                        fingers,
                        TrackpadGesturePhase::Ended,
                        (0.0, 0.0),
                        total,
                        (0.0, total_spread),
                        f.ts,
                        None,
                    ));
                }
                if f.touching != fingers {
                    self.state = if f.touching >= 3 {
                        State::Arming { fingers: f.touching, frames: 1, start: f.centroid }
                    } else {
                        State::Idle
                    };
                    return Some(gesture(
                        fingers,
                        TrackpadGesturePhase::Ended,
                        (0.0, 0.0),
                        total,
                        (0.0, total_spread),
                        f.ts,
                        None,
                    ));
                }
                let d = (f.centroid.0 - last.0, f.centroid.1 - last.1);
                let total = (total.0 + d.0, total.1 + d.1);
                let d_spread = f.spread - last_spread;
                let total_spread = total_spread + d_spread;
                self.state = State::Tracking { fingers, last: f.centroid, total, last_spread: f.spread, total_spread };
                Some(gesture(fingers, TrackpadGesturePhase::Changed, d, total, (d_spread, total_spread), f.ts, None))
            }
        }
    }
}

fn gesture(
    fingers: usize, phase: TrackpadGesturePhase, d: (f64, f64), total: (f64, f64), spread: (f64, f64), ts: f64,
    device: Option<(f64, f64)>,
) -> TrackpadGesture {
    TrackpadGesture {
        fingers: fingers as u32,
        phase,
        dx: d.0,
        dy: d.1,
        total_dx: total.0,
        total_dy: total.1,
        d_spread: spread.0,
        total_d_spread: spread.1,
        ts,
        device_w: device.map(|s| s.0),
        device_h: device.map(|s| s.1),
    }
}

fn aggregate(positions: &[(f64, f64)]) -> ((f64, f64), f64) {
    let n = positions.len() as f64;
    let cx = positions.iter().map(|p| p.0).sum::<f64>() / n;
    let cy = positions.iter().map(|p| p.1).sum::<f64>() / n;
    let spread = positions.iter().map(|p| (p.0 - cx).hypot(p.1 - cy)).sum::<f64>() / n;
    ((cx, cy), spread)
}

fn emit_gesture(app: &AppHandle, out: TrackpadGesture) {
    if !matches!(out.phase, TrackpadGesturePhase::Changed) {
        log::info!("[trackpad] {out:?}");
    }
    if let Err(error) = out.emit_to(app, "main") {
        log::error!("Cannot emit trackpad gesture: {error}");
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq)]
struct TouchEntry {
    tip: bool,

    x: f64,
    y: f64,
}

#[cfg(any(target_os = "windows", test))]
struct FrameAssembler {
    expected: usize,
    buf: Vec<TouchEntry>,
}

#[cfg(any(target_os = "windows", test))]
impl FrameAssembler {
    fn new() -> Self {
        Self { expected: 0, buf: Vec::new() }
    }

    fn push(&mut self, contact_count: usize, mut entries: Vec<TouchEntry>) -> Option<Vec<TouchEntry>> {
        if contact_count > 0 {
            self.expected = contact_count;
            self.buf.clear();
        } else if self.expected == 0 {
            return None;
        }
        let need = self.expected - self.buf.len();
        entries.truncate(need);
        self.buf.append(&mut entries);
        if self.buf.len() >= self.expected {
            self.expected = 0;
            Some(std::mem::take(&mut self.buf))
        } else {
            None
        }
    }
}

#[cfg(test)]
#[path = "__tests__/machine.rs"]
mod tests;
