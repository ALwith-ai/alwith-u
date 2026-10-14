use crate::lifecycle::{FrontendTarget, Generation};
use serde::Serialize;
use std::collections::HashMap;

pub(crate) const DEFAULT_INSET_X: f64 = 12.0;
pub(crate) const DEFAULT_INSET_Y: f64 = 16.0;
const CLEARANCE_GAP: f64 = 8.0;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct NativeWindowKey {
    pub(crate) native_window: usize,
}

impl NativeWindowKey {
    pub(crate) fn new(native_window: usize) -> Self {
        Self { native_window }
    }
}

#[cfg(test)]
impl From<usize> for NativeWindowKey {
    fn from(value: usize) -> Self {
        Self::new(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Activation {
    InstallListener(Generation),
    ReuseListener(Generation),
}

impl Activation {
    pub(crate) fn generation(self) -> Generation {
        match self {
            Self::InstallListener(generation) | Self::ReuseListener(generation) => generation,
        }
    }

    pub(crate) fn installs_listener(self) -> bool {
        matches!(self, Self::InstallListener(_))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum NativeObservation {
    Fullscreen,
    Normal { measured_cluster_right_edge: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MacosTitlebarState {
    pub(crate) fullscreen: bool,
    pub(crate) clearance: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TrafficSnapshot {
    pub(crate) inset_x: f64,
    pub(crate) inset_y: f64,
    pub(crate) target: Option<FrontendTarget>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct NativeRect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct NativeGeometry {
    pub(crate) titlebar: NativeRect,
    pub(crate) titlebar_top_margin: f64,
    pub(crate) buttons: [Option<NativeRect>; 3],
}

pub(crate) fn restore_titlebar_rect(
    mut current: NativeRect,
    original: NativeRect,
    window_height: f64,
    top_margin: f64,
) -> NativeRect {
    current.y = window_height - top_margin - original.height;
    current.height = original.height;
    current
}

pub(crate) fn restore_button_rect(mut current: NativeRect, original: NativeRect) -> NativeRect {
    current.x = original.x;
    current.y = original.y;
    current
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Deactivation {
    pub(crate) generation: Generation,
    pub(crate) target: Option<FrontendTarget>,
    pub(crate) original_geometry: Option<NativeGeometry>,
}

#[derive(Clone, Copy, Debug)]
struct WindowState {
    generation: Option<Generation>,
    inset_x: f64,
    inset_y: f64,
    last_normal_cluster_right_edge: f64,
    target: Option<FrontendTarget>,
    last_dispatched: Option<(FrontendTarget, MacosTitlebarState)>,
    original_geometry: Option<NativeGeometry>,
    positioning_enabled: bool,
    listener_installed: bool,
}

impl WindowState {
    fn new(inset_x: f64, inset_y: f64) -> Self {
        Self {
            generation: None,
            inset_x,
            inset_y,
            last_normal_cluster_right_edge: 0.0,
            target: None,
            last_dispatched: None,
            original_geometry: None,
            positioning_enabled: false,
            listener_installed: false,
        }
    }

    fn activation(self) -> Option<Activation> {
        let generation = self.generation?;
        if self.listener_installed {
            Some(Activation::ReuseListener(generation))
        } else {
            Some(Activation::InstallListener(generation))
        }
    }

    fn snapshot(self) -> TrafficSnapshot {
        TrafficSnapshot {
            inset_x: self.inset_x,
            inset_y: self.inset_y,
            target: self.target,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct TrafficRegistry {
    windows: HashMap<NativeWindowKey, WindowState>,
}

impl TrafficRegistry {
    fn ensure_state(&mut self, key: NativeWindowKey) -> &mut WindowState {
        self.windows
            .entry(key)
            .or_insert_with(|| WindowState::new(DEFAULT_INSET_X, DEFAULT_INSET_Y))
    }

    pub(crate) fn activate(
        &mut self,
        key: impl Into<NativeWindowKey>,
        target: FrontendTarget,
    ) -> Activation {
        let key = key.into();
        let replaces_generation = self
            .windows
            .get(&key)
            .and_then(|state| state.generation)
            .is_some_and(|generation| generation != target.window);

        if replaces_generation {
            let previous = self.windows[&key];
            self.windows
                .insert(key, WindowState::new(previous.inset_x, previous.inset_y));
        }

        let state = self.ensure_state(key);
        state.generation = Some(target.window);
        state.positioning_enabled = true;
        if state.target != Some(target) {
            state.target = Some(target);
            state.last_dispatched = None;
        }
        state
            .activation()
            .expect("an activated traffic-light state has a generation")
    }

    pub(crate) fn mark_listener_installed(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
    ) -> bool {
        let key = key.into();
        let Some(state) = self.windows.get_mut(&key) else {
            return false;
        };
        if state.generation != Some(generation) {
            return false;
        }
        state.listener_installed = true;
        true
    }

    pub(crate) fn begin_deactivation(
        &mut self,
        key: impl Into<NativeWindowKey>,
    ) -> Option<Deactivation> {
        let key = key.into();
        let state = self.windows.get_mut(&key)?;
        let generation = state.generation?;
        state.positioning_enabled = false;
        Some(Deactivation {
            generation,
            target: state.target,
            original_geometry: state.original_geometry,
        })
    }

    pub(crate) fn commit_deactivation(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
    ) -> bool {
        let key = key.into();
        let Some(state) = self.windows.get_mut(&key) else {
            return false;
        };
        if state.generation != Some(generation) || state.positioning_enabled {
            return false;
        }
        state.target = None;
        state.last_dispatched = None;
        state.original_geometry = None;
        state.last_normal_cluster_right_edge = 0.0;
        true
    }

    pub(crate) fn record_original_geometry(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
        geometry: NativeGeometry,
    ) -> bool {
        let key = key.into();
        let Some(state) = self.windows.get_mut(&key) else {
            return false;
        };
        if state.generation != Some(generation)
            || !state.positioning_enabled
            || state.original_geometry.is_some()
        {
            return false;
        }
        state.original_geometry = Some(geometry);
        true
    }

    pub(crate) fn destroy(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
    ) -> bool {
        let key = key.into();
        let is_current = self
            .windows
            .get(&key)
            .is_some_and(|state| state.generation == Some(generation));
        if is_current {
            self.windows.remove(&key);
        }
        is_current
    }

    pub(crate) fn set_inset(
        &mut self,
        key: impl Into<NativeWindowKey>,
        inset_x: f64,
        inset_y: f64,
    ) -> Result<Option<Activation>, &'static str> {
        let key = key.into();
        if !valid_inset(inset_x) || !valid_inset(inset_y) {
            return Err("traffic-light insets must be finite and nonnegative");
        }
        let state = self.ensure_state(key);
        state.inset_x = inset_x;
        state.inset_y = inset_y;
        Ok(state.activation())
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self, key: impl Into<NativeWindowKey>) -> Option<TrafficSnapshot> {
        let key = key.into();
        self.windows.get(&key).copied().map(WindowState::snapshot)
    }

    pub(crate) fn snapshot_for_listener(
        &self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
    ) -> Option<TrafficSnapshot> {
        let key = key.into();
        self.windows
            .get(&key)
            .filter(|state| state.generation == Some(generation) && state.positioning_enabled)
            .copied()
            .map(WindowState::snapshot)
    }

    pub(crate) fn record_observation(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
        observation: NativeObservation,
    ) -> Option<(FrontendTarget, MacosTitlebarState)> {
        let key = key.into();
        let state = self.windows.get_mut(&key)?;
        if state.generation != Some(generation) || !state.positioning_enabled {
            return None;
        }
        let (fullscreen, clearance) = match observation {
            NativeObservation::Fullscreen => (true, 0.0),
            NativeObservation::Normal {
                measured_cluster_right_edge,
            } => {
                if measured_cluster_right_edge.is_finite() && measured_cluster_right_edge > 0.0 {
                    state.last_normal_cluster_right_edge = measured_cluster_right_edge;
                }
                let edge = state.last_normal_cluster_right_edge;
                if edge > 0.0 {
                    (false, edge + CLEARANCE_GAP)
                } else {
                    (false, 0.0)
                }
            }
        };
        let target = state.target?;
        let dispatch = (
            target,
            MacosTitlebarState {
                fullscreen,
                clearance,
            },
        );
        if state.last_dispatched == Some(dispatch) {
            return None;
        }
        state.last_dispatched = Some(dispatch);
        Some(dispatch)
    }

    pub(crate) fn rollback_dispatch(
        &mut self,
        key: impl Into<NativeWindowKey>,
        generation: Generation,
        target: FrontendTarget,
        titlebar: MacosTitlebarState,
    ) -> bool {
        let key = key.into();
        let Some(state) = self.windows.get_mut(&key) else {
            return false;
        };
        if state.generation != Some(generation) || state.last_dispatched != Some((target, titlebar))
        {
            return false;
        }
        state.last_dispatched = None;
        true
    }
}

fn valid_inset(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

#[cfg(test)]
mod tests {
    use super::{
        Activation, MacosTitlebarState, NativeGeometry, NativeObservation, NativeRect,
        TrafficRegistry, TrafficSnapshot,
    };
    use crate::lifecycle::FrontendTarget;

    fn target(window: u64, document: u64) -> FrontendTarget {
        FrontendTarget::from_values(window, document).unwrap()
    }

    fn titlebar(fullscreen: bool, clearance: f64) -> MacosTitlebarState {
        MacosTitlebarState {
            fullscreen,
            clearance,
        }
    }

    #[test]
    fn first_activation_installs_one_listener_and_reactivation_retargets_it() {
        let mut registry = TrafficRegistry::default();

        let first = registry.activate(0x100, target(1, 10));
        assert!(matches!(first, Activation::InstallListener(_)));
        assert!(registry.mark_listener_installed(0x100, first.generation()));
        assert_eq!(
            registry.activate(0x100, target(1, 11)),
            Activation::ReuseListener(first.generation())
        );
        assert_eq!(
            registry.snapshot(0x100).unwrap().target,
            Some(target(1, 11))
        );
    }

    #[test]
    fn native_pointer_reuse_allocates_a_new_listener_identity() {
        let mut registry = TrafficRegistry::default();
        registry.set_inset(0x100, 24.0, 18.0).unwrap();
        let old = registry.activate(0x100, target(1, 10));
        assert!(registry.mark_listener_installed(0x100, old.generation()));
        assert!(registry.record_original_geometry(
            0x100,
            old.generation(),
            NativeGeometry::default()
        ));

        let replacement = registry.activate(0x100, target(2, 20));

        assert!(replacement.installs_listener());
        assert_ne!(replacement.generation(), old.generation());
        assert_eq!(
            registry.snapshot(0x100),
            Some(TrafficSnapshot {
                inset_x: 24.0,
                inset_y: 18.0,
                target: Some(target(2, 20)),
            })
        );
        assert!(!registry.mark_listener_installed(0x100, old.generation()));
        assert!(registry.mark_listener_installed(0x100, replacement.generation()));
        assert_eq!(
            registry
                .begin_deactivation(0x100)
                .unwrap()
                .original_geometry,
            None
        );
    }

    #[test]
    fn stale_listener_cannot_observe_or_destroy_replacement_state() {
        let mut registry = TrafficRegistry::default();
        let old = registry.activate(0x100, target(1, 10));
        let replacement = registry.activate(0x100, target(2, 20));

        assert_eq!(
            registry.snapshot_for_listener(0x100, old.generation()),
            None
        );
        assert_eq!(
            registry.record_observation(
                0x100,
                old.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: 100.0,
                },
            ),
            None
        );
        assert!(!registry.destroy(0x100, old.generation()));
        assert_eq!(
            registry.snapshot_for_listener(0x100, replacement.generation()),
            registry.snapshot(0x100)
        );
        assert!(registry.destroy(0x100, replacement.generation()));
    }

    #[test]
    fn a_new_window_generation_rotates_state_for_the_same_nswindow_pointer() {
        let mut registry = TrafficRegistry::default();
        let old = registry.activate(0x100, target(1, 10));
        assert!(registry.mark_listener_installed(0x100, old.generation()));
        let replacement = registry.activate(0x100, target(2, 20));

        assert_ne!(replacement.generation(), old.generation());
        assert!(replacement.installs_listener());
        assert!(!registry.destroy(0x100, old.generation()));
        assert_eq!(
            registry.snapshot(0x100).unwrap().target,
            Some(target(2, 20))
        );
    }

    #[test]
    fn restoration_preserves_current_width_and_native_button_sizes_after_resize() {
        let titlebar = super::restore_titlebar_rect(
            NativeRect {
                x: 0.0,
                y: 760.0,
                width: 1200.0,
                height: 40.0,
            },
            NativeRect {
                x: 0.0,
                y: 772.0,
                width: 800.0,
                height: 28.0,
            },
            800.0,
            0.0,
        );
        assert_eq!(
            titlebar,
            NativeRect {
                x: 0.0,
                y: 772.0,
                width: 1200.0,
                height: 28.0,
            }
        );

        let button = super::restore_button_rect(
            NativeRect {
                x: 12.0,
                y: 13.0,
                width: 18.0,
                height: 18.0,
            },
            NativeRect {
                x: 7.0,
                y: 8.0,
                width: 14.0,
                height: 14.0,
            },
        );
        assert_eq!(
            button,
            NativeRect {
                x: 7.0,
                y: 8.0,
                width: 18.0,
                height: 18.0,
            }
        );
    }

    #[test]
    fn deactivation_clears_only_the_document_target() {
        let mut registry = TrafficRegistry::default();
        registry.set_inset(0x100, 24.0, 18.0).unwrap();
        let activation = registry.activate(0x100, target(1, 10));
        registry.mark_listener_installed(0x100, activation.generation());

        assert_eq!(
            registry.begin_deactivation(0x100).unwrap().target,
            Some(target(1, 10))
        );
        assert_eq!(
            registry.snapshot_for_listener(0x100, activation.generation()),
            None
        );
        assert_eq!(
            registry.begin_deactivation(0x100).unwrap().target,
            Some(target(1, 10))
        );
        assert!(registry.commit_deactivation(0x100, activation.generation()));
        assert_eq!(
            registry.snapshot(0x100),
            Some(TrafficSnapshot {
                inset_x: 24.0,
                inset_y: 18.0,
                target: None,
            })
        );
        assert_eq!(
            registry.activate(0x100, target(1, 11)),
            Activation::ReuseListener(activation.generation())
        );
    }

    #[test]
    fn windows_are_isolated_and_destroy_removes_only_the_matching_window() {
        let mut registry = TrafficRegistry::default();
        registry.set_inset(0x100, 10.0, 11.0).unwrap();
        registry.set_inset(0x200, 20.0, 21.0).unwrap();
        let first = registry.activate(0x100, target(1, 10));
        registry.activate(0x200, target(2, 20));

        assert!(registry.destroy(0x100, first.generation()));
        assert_eq!(registry.snapshot(0x100), None);
        assert_eq!(
            registry.snapshot(0x200).unwrap().target,
            Some(target(2, 20))
        );
        assert!(!registry.destroy(0x100, first.generation()));
    }

    #[test]
    fn inset_before_activation_is_preserved_and_inputs_are_finite_nonnegative() {
        let mut registry = TrafficRegistry::default();
        assert_eq!(registry.set_inset(0x100, 16.0, 20.0).unwrap(), None);
        let initial = registry.activate(0x100, target(1, 10));
        assert!(initial.installs_listener());
        registry.mark_listener_installed(0x100, initial.generation());

        let snapshot = registry.snapshot(0x100).unwrap();
        assert_eq!((snapshot.inset_x, snapshot.inset_y), (16.0, 20.0));
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.01] {
            assert!(registry.set_inset(0x100, invalid, 1.0).is_err());
            assert!(registry.set_inset(0x100, 1.0, invalid).is_err());
        }
    }

    #[test]
    fn native_observations_encode_fullscreen_and_clearance_atomically() {
        let mut registry = TrafficRegistry::default();
        let activation = registry.activate(0x100, target(1, 10));

        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Fullscreen
            ),
            Some((
                target(1, 10),
                MacosTitlebarState {
                    fullscreen: true,
                    clearance: 0.0,
                },
            )),
        );
        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: 64.0,
                },
            ),
            Some((
                target(1, 10),
                MacosTitlebarState {
                    fullscreen: false,
                    clearance: 72.0,
                },
            )),
        );
    }

    #[test]
    fn fullscreen_collapses_clearance_and_normal_refresh_restores_the_cache() {
        let mut registry = TrafficRegistry::default();
        let activation = registry.activate(0x100, target(1, 10));

        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: 64.0,
                },
            ),
            Some((target(1, 10), titlebar(false, 72.0)))
        );
        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Fullscreen
            ),
            Some((target(1, 10), titlebar(true, 0.0)))
        );
        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: 0.0,
                },
            ),
            Some((target(1, 10), titlebar(false, 72.0)))
        );
    }

    #[test]
    fn duplicate_native_events_do_not_redispatch_identical_clearance() {
        let mut registry = TrafficRegistry::default();
        let activation = registry.activate(0x100, target(1, 10));
        let observation = NativeObservation::Normal {
            measured_cluster_right_edge: 64.0,
        };

        assert_eq!(
            registry.record_observation(0x100, activation.generation(), observation),
            Some((target(1, 10), titlebar(false, 72.0)))
        );
        assert_eq!(
            registry.record_observation(0x100, activation.generation(), observation),
            None
        );

        let next_document = registry.activate(0x100, target(1, 11));
        assert_eq!(next_document.generation(), activation.generation());
        assert_eq!(
            registry.record_observation(0x100, activation.generation(), observation),
            Some((target(1, 11), titlebar(false, 72.0)))
        );
    }

    #[test]
    fn failed_frontend_dispatch_can_release_the_deduplication_claim() {
        let mut registry = TrafficRegistry::default();
        let activation = registry.activate(0x100, target(1, 10));
        let observation = NativeObservation::Normal {
            measured_cluster_right_edge: 64.0,
        };
        let dispatch = registry
            .record_observation(0x100, activation.generation(), observation)
            .unwrap();

        assert!(registry.rollback_dispatch(0x100, activation.generation(), dispatch.0, dispatch.1));
        assert_eq!(
            registry.record_observation(0x100, activation.generation(), observation),
            Some(dispatch)
        );
    }

    #[test]
    fn deactivation_retains_original_geometry_until_restoration_commits() {
        let mut registry = TrafficRegistry::default();
        let activation = registry.activate(0x100, target(1, 10));
        let original = NativeGeometry {
            titlebar: NativeRect {
                x: 1.0,
                y: 2.0,
                width: 300.0,
                height: 28.0,
            },
            titlebar_top_margin: 0.0,
            buttons: [
                Some(NativeRect {
                    x: 7.0,
                    y: 8.0,
                    width: 14.0,
                    height: 14.0,
                }),
                None,
                None,
            ],
        };

        assert!(registry.record_original_geometry(0x100, activation.generation(), original));
        assert!(!registry.record_original_geometry(0x100, activation.generation(), original));

        let deactivation = registry.begin_deactivation(0x100).unwrap();
        assert_eq!(deactivation.target, Some(target(1, 10)));
        assert_eq!(deactivation.original_geometry, Some(original));
        assert!(registry.commit_deactivation(0x100, activation.generation()));
        assert_eq!(
            registry
                .begin_deactivation(0x100)
                .unwrap()
                .original_geometry,
            None
        );
    }

    #[test]
    fn observations_while_deactivated_are_inert() {
        let mut registry = TrafficRegistry::default();
        assert_eq!(registry.set_inset(0x100, 12.0, 16.0).unwrap(), None);
        let activation = registry.activate(0x100, target(1, 10));
        registry.begin_deactivation(0x100).unwrap();

        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: 64.0,
                },
            ),
            None
        );
        registry.activate(0x100, target(1, 11));
        assert_eq!(
            registry.record_observation(
                0x100,
                activation.generation(),
                NativeObservation::Normal {
                    measured_cluster_right_edge: f64::NAN,
                },
            ),
            Some((target(1, 11), titlebar(false, 0.0)))
        );
    }
}
