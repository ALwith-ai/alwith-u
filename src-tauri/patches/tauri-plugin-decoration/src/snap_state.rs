use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering},
        Arc,
    },
};
use tokio::sync::Notify;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SnapEvent {
    MouseEnter,
    MouseLeave,
    MouseDown,
    MouseUp,
    Click,
}

impl SnapEvent {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MouseEnter => "snap-mouseenter",
            Self::MouseLeave => "snap-mouseleave",
            Self::MouseDown => "snap-mousedown",
            Self::MouseUp => "snap-mouseup",
            Self::Click => "snap-click",
        }
    }
}

type EventCallback = Arc<dyn Fn(SnapEvent) + Send + Sync + 'static>;
type CloseCallback = Arc<dyn Fn() + Send + Sync + 'static>;

const HOVERED: u8 = 1;
const PRESSED: u8 = 2;
const MAX_CLICK_EDGES_PER_FLUSH: u32 = 32;

pub(crate) struct EventBridge {
    state: AtomicU8,
    clicks: AtomicU32,
    closed: AtomicBool,
    notify: Notify,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct EventSnapshot {
    hovered: bool,
    pressed: bool,
    clicks: u32,
}

impl EventSnapshot {
    pub(crate) fn hovered(self) -> bool {
        self.hovered
    }

    pub(crate) fn pressed(self) -> bool {
        self.pressed
    }

    pub(crate) fn clicks(self) -> u32 {
        self.clicks
    }
}

impl EventBridge {
    pub(crate) fn new() -> Self {
        Self {
            state: AtomicU8::new(0),
            clicks: AtomicU32::new(0),
            closed: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    pub(crate) fn publish(&self, event: SnapEvent) {
        match event {
            SnapEvent::MouseEnter => {
                self.state.fetch_or(HOVERED, Ordering::Release);
            }
            SnapEvent::MouseLeave => {
                self.state
                    .fetch_and(!(HOVERED | PRESSED), Ordering::Release);
            }
            SnapEvent::MouseDown => {
                self.state.fetch_or(PRESSED, Ordering::Release);
            }
            SnapEvent::MouseUp => {
                self.state.fetch_and(!PRESSED, Ordering::Release);
            }
            SnapEvent::Click => {
                let _ = self
                    .clicks
                    .fetch_update(Ordering::Release, Ordering::Relaxed, |clicks| {
                        Some(clicks.saturating_add(1))
                    });
            }
        }
        self.notify.notify_one();
    }

    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.notify.notify_one();
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    #[cfg(target_os = "windows")]
    pub(crate) async fn wait(&self) {
        self.notify.notified().await;
    }

    pub(crate) fn take(&self) -> EventSnapshot {
        let state = self.state.load(Ordering::Acquire);
        let clicks = self
            .clicks
            .fetch_update(Ordering::Acquire, Ordering::Relaxed, |clicks| {
                Some(clicks.saturating_sub(MAX_CLICK_EDGES_PER_FLUSH))
            })
            .unwrap_or(0);
        if clicks > MAX_CLICK_EDGES_PER_FLUSH {
            self.notify.notify_one();
        }
        EventSnapshot {
            hovered: state & HOVERED != 0,
            pressed: state & PRESSED != 0,
            clicks: clicks.min(MAX_CLICK_EDGES_PER_FLUSH),
        }
    }
}

#[derive(Clone)]
pub(crate) struct Callbacks {
    event: EventCallback,
    close: Option<CloseCallback>,
}

impl Callbacks {
    #[cfg(test)]
    pub(crate) fn new(event: EventCallback) -> Self {
        Self { event, close: None }
    }

    pub(crate) fn with_close(event: EventCallback, close: CloseCallback) -> Self {
        Self {
            event,
            close: Some(close),
        }
    }

    pub(crate) fn close(&self) {
        if let Some(close) = &self.close {
            close();
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Geometry {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl Geometry {
    pub(crate) fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

struct Entry {
    overlay: isize,
    overlay_live: bool,
    geometry: Geometry,
    hovering: bool,
    pressing: bool,
    fullscreen: bool,
    awaiting_geometry: bool,
    callbacks: Callbacks,
}

pub(crate) struct Removed {
    #[cfg(test)]
    parent: isize,
    entry: Entry,
}

impl Removed {
    #[cfg(test)]
    pub(crate) fn parent(&self) -> isize {
        self.parent
    }

    #[cfg(test)]
    pub(crate) fn overlay(&self) -> isize {
        self.entry.overlay
    }

    pub(crate) fn close(&self) {
        self.entry.callbacks.close();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Position {
    overlay: isize,
    overlay_live: bool,
    geometry: Geometry,
    fullscreen: bool,
    awaiting_geometry: bool,
}

impl Position {
    pub(crate) fn overlay(self) -> isize {
        self.overlay
    }

    pub(crate) fn overlay_live(self) -> bool {
        self.overlay_live
    }

    pub(crate) fn x(self) -> i32 {
        self.geometry.x
    }

    pub(crate) fn y(self) -> i32 {
        self.geometry.y
    }

    pub(crate) fn width(self) -> u32 {
        self.geometry.width
    }

    pub(crate) fn height(self) -> u32 {
        self.geometry.height
    }

    pub(crate) fn fullscreen(self) -> bool {
        self.fullscreen
    }

    pub(crate) fn awaiting_geometry(self) -> bool {
        self.awaiting_geometry
    }
}

enum Effect {
    Event(EventCallback, SnapEvent),
}

#[derive(Default)]
pub(crate) struct Effects(Vec<Effect>);

impl Effects {
    fn event(&mut self, callbacks: &Callbacks, event: SnapEvent) {
        self.0.push(Effect::Event(callbacks.event.clone(), event));
    }

    pub(crate) fn entered(&self) -> bool {
        self.0
            .iter()
            .any(|effect| matches!(effect, Effect::Event(_, SnapEvent::MouseEnter)))
    }

    pub(crate) fn dispatch(self) {
        for effect in self.0 {
            let Effect::Event(callback, event) = effect;
            callback(event);
        }
    }
}

#[derive(Default)]
pub(crate) struct Registry {
    entries: HashMap<isize, Entry>,
}

impl Registry {
    pub(crate) fn insert(
        &mut self,
        parent: isize,
        overlay: isize,
        geometry: Geometry,
        callbacks: Callbacks,
    ) -> Result<(), &'static str> {
        if self.entries.contains_key(&parent) {
            return Err("a snap overlay is already installed for this window");
        }
        self.entries.insert(
            parent,
            Entry {
                overlay,
                overlay_live: true,
                geometry,
                hovering: false,
                pressing: false,
                fullscreen: false,
                awaiting_geometry: false,
                callbacks,
            },
        );
        Ok(())
    }

    pub(crate) fn remove_parent(&mut self, parent: isize) -> Option<Removed> {
        self.entries.remove(&parent).map(|entry| Removed {
            #[cfg(test)]
            parent,
            entry,
        })
    }

    #[cfg(test)]
    pub(crate) fn remove_overlay(&mut self, overlay: isize) -> Option<Removed> {
        let parent = self.parent_for_overlay(overlay)?;
        self.remove_parent(parent)
    }

    pub(crate) fn mark_overlay_destroyed(&mut self, overlay: isize) -> Option<isize> {
        let parent = self.parent_for_overlay(overlay)?;
        self.entries
            .get_mut(&parent)
            .expect("overlay lookup returned an existing parent")
            .overlay_live = false;
        Some(parent)
    }

    pub(crate) fn position(&self, parent: isize) -> Option<Position> {
        self.entries.get(&parent).map(|entry| Position {
            overlay: entry.overlay,
            overlay_live: entry.overlay_live,
            geometry: entry.geometry,
            fullscreen: entry.fullscreen,
            awaiting_geometry: entry.awaiting_geometry,
        })
    }

    pub(crate) fn update_geometry(
        &mut self,
        parent: isize,
        geometry: Geometry,
    ) -> Option<Position> {
        let entry = self.entries.get_mut(&parent)?;
        entry.geometry = geometry;
        entry.awaiting_geometry = false;
        Some(Position {
            overlay: entry.overlay,
            overlay_live: entry.overlay_live,
            geometry,
            fullscreen: entry.fullscreen,
            awaiting_geometry: entry.awaiting_geometry,
        })
    }

    pub(crate) fn set_fullscreen(
        &mut self,
        parent: isize,
        fullscreen: bool,
    ) -> Option<(Position, Effects)> {
        let entry = self.entries.get_mut(&parent)?;
        if entry.fullscreen == fullscreen {
            return None;
        }
        entry.fullscreen = fullscreen;
        entry.awaiting_geometry = true;
        Some((
            Position {
                overlay: entry.overlay,
                overlay_live: entry.overlay_live,
                geometry: entry.geometry,
                fullscreen,
                awaiting_geometry: entry.awaiting_geometry,
            },
            Effects::default(),
        ))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn await_fresh_geometry(&mut self, parent: isize) -> Option<Position> {
        let entry = self.entries.get_mut(&parent)?;
        entry.awaiting_geometry = true;
        Some(Position {
            overlay: entry.overlay,
            overlay_live: entry.overlay_live,
            geometry: entry.geometry,
            fullscreen: entry.fullscreen,
            awaiting_geometry: true,
        })
    }

    pub(crate) fn rollback_fullscreen(&mut self, parent: isize, attempted: bool) -> bool {
        let Some(entry) = self.entries.get_mut(&parent) else {
            return false;
        };
        if entry.fullscreen != attempted {
            return false;
        }
        entry.fullscreen = !attempted;
        true
    }

    pub(crate) fn parent_for_overlay(&self, overlay: isize) -> Option<isize> {
        self.entries
            .iter()
            .find_map(|(parent, entry)| (entry.overlay == overlay).then_some(*parent))
    }

    pub(crate) fn mouse_move(&mut self, overlay: isize) -> Effects {
        let Some(parent) = self.parent_for_overlay(overlay) else {
            return Effects::default();
        };
        let entry = self
            .entries
            .get_mut(&parent)
            .expect("overlay lookup returned an existing parent");
        let mut effects = Effects::default();
        if !entry.hovering {
            entry.hovering = true;
            effects.event(&entry.callbacks, SnapEvent::MouseEnter);
        }
        effects
    }

    pub(crate) fn mouse_leave(&mut self, overlay: isize) -> Effects {
        let Some(parent) = self.parent_for_overlay(overlay) else {
            return Effects::default();
        };
        let entry = self
            .entries
            .get_mut(&parent)
            .expect("overlay lookup returned an existing parent");
        let should_emit = entry.hovering || entry.pressing;
        entry.hovering = false;
        entry.pressing = false;
        let mut effects = Effects::default();
        if should_emit {
            effects.event(&entry.callbacks, SnapEvent::MouseLeave);
        }
        effects
    }

    pub(crate) fn mouse_down(&mut self, overlay: isize) -> Effects {
        let Some(parent) = self.parent_for_overlay(overlay) else {
            return Effects::default();
        };
        let entry = self
            .entries
            .get_mut(&parent)
            .expect("overlay lookup returned an existing parent");
        entry.pressing = true;
        let mut effects = Effects::default();
        effects.event(&entry.callbacks, SnapEvent::MouseDown);
        effects
    }

    pub(crate) fn mouse_up(&mut self, overlay: isize) -> Effects {
        let Some(parent) = self.parent_for_overlay(overlay) else {
            return Effects::default();
        };
        let entry = self
            .entries
            .get_mut(&parent)
            .expect("overlay lookup returned an existing parent");
        let click = entry.pressing;
        entry.pressing = false;
        let mut effects = Effects::default();
        effects.event(&entry.callbacks, SnapEvent::MouseUp);
        if click {
            effects.event(&entry.callbacks, SnapEvent::Click);
        }
        effects
    }
}

#[cfg(test)]
mod tests {
    use super::{Callbacks, EventBridge, Geometry, Registry, SnapEvent};
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex, Weak,
        },
    };

    struct RegistryLockProbe {
        registry: Weak<Mutex<Registry>>,
        dropped_outside_lock: Arc<AtomicBool>,
    }

    impl Drop for RegistryLockProbe {
        fn drop(&mut self) {
            let lock_available = self
                .registry
                .upgrade()
                .is_some_and(|registry| registry.try_lock().is_ok());
            self.dropped_outside_lock
                .store(lock_available, Ordering::SeqCst);
        }
    }

    fn callbacks(events: Arc<Mutex<Vec<String>>>) -> Callbacks {
        Callbacks::new(Arc::new(move |event| {
            events.lock().unwrap().push(format!("{event:?}"));
        }))
    }

    #[test]
    fn duplicate_install_is_rejected_without_replacing_the_original() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(
                10,
                100,
                Geometry::new(10, 2, 58, 32),
                callbacks(events.clone()),
            )
            .unwrap();

        assert!(registry
            .insert(10, 101, Geometry::new(20, 3, 60, 40), callbacks(events))
            .is_err());

        assert_eq!(registry.position(10).unwrap().overlay(), 100);
    }

    #[test]
    fn pointer_transitions_are_ordered_and_duplicate_moves_are_suppressed() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(
                10,
                100,
                Geometry::new(10, 2, 58, 32),
                callbacks(events.clone()),
            )
            .unwrap();

        let first_move = registry.mouse_move(100);
        assert!(first_move.entered());
        first_move.dispatch();
        registry.mouse_move(100).dispatch();
        registry.mouse_down(100).dispatch();
        registry.mouse_up(100).dispatch();
        registry.mouse_leave(100).dispatch();

        assert_eq!(
            *events.lock().unwrap(),
            ["MouseEnter", "MouseDown", "MouseUp", "Click", "MouseLeave",]
        );
    }

    #[test]
    fn fullscreen_changes_are_deduped_and_expose_native_visibility_state() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(
                10,
                100,
                Geometry::new(10, 2, 58, 32),
                callbacks(events.clone()),
            )
            .unwrap();

        let (entered, effects) = registry
            .set_fullscreen(10, true)
            .expect("first fullscreen transition");
        assert!(entered.fullscreen());
        assert_eq!(entered.overlay(), 100);
        effects.dispatch();
        assert!(registry.set_fullscreen(10, true).is_none());

        let (exited, effects) = registry.set_fullscreen(10, false).expect("fullscreen exit");
        assert!(!exited.fullscreen());
        assert!(exited.awaiting_geometry());
        effects.dispatch();

        let fresh = registry
            .update_geometry(10, Geometry::new(11, 3, 60, 34))
            .expect("geometry update keeps the overlay registered");
        assert!(!fresh.awaiting_geometry());

        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn failed_fullscreen_transition_can_be_rolled_back_and_retried() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(10, 100, Geometry::new(10, 2, 58, 32), callbacks(events))
            .unwrap();
        let _enter = registry.set_fullscreen(10, true).expect("fullscreen entry");

        let _failed_exit = registry
            .set_fullscreen(10, false)
            .expect("first fullscreen exit");
        assert!(registry.rollback_fullscreen(10, false));
        assert!(registry.position(10).unwrap().fullscreen());
        assert!(registry.set_fullscreen(10, false).is_some());
    }

    #[test]
    fn effects_can_reenter_the_registry_because_callbacks_are_not_run_under_its_lock() {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let callback_registry = registry.clone();
        let event = Arc::new(move |event| {
            assert_eq!(event, SnapEvent::MouseEnter);
            assert!(callback_registry.try_lock().is_ok());
        });
        registry
            .lock()
            .unwrap()
            .insert(10, 100, Geometry::new(10, 2, 58, 32), Callbacks::new(event))
            .unwrap();

        let effects = registry.lock().unwrap().mouse_move(100);
        effects.dispatch();
    }

    #[test]
    fn removed_callbacks_are_dropped_after_the_registry_lock_is_released() {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let dropped_outside_lock = Arc::new(AtomicBool::new(false));
        let probe = RegistryLockProbe {
            registry: Arc::downgrade(&registry),
            dropped_outside_lock: dropped_outside_lock.clone(),
        };
        let callback = Arc::new(move |_| {
            let _keep_probe_alive = &probe;
        });
        registry
            .lock()
            .unwrap()
            .insert(
                10,
                100,
                Geometry::new(10, 2, 58, 32),
                Callbacks::new(callback),
            )
            .unwrap();

        let removed = registry
            .lock()
            .unwrap()
            .remove_parent(10)
            .expect("registered overlay");
        drop(removed);

        assert!(dropped_outside_lock.load(Ordering::SeqCst));
    }

    #[test]
    fn callback_panics_do_not_poison_the_registry_lock() {
        let registry = Arc::new(Mutex::new(Registry::default()));
        registry
            .lock()
            .unwrap()
            .insert(
                10,
                100,
                Geometry::new(10, 2, 58, 32),
                Callbacks::new(Arc::new(|_| panic!("callback panic"))),
            )
            .unwrap();

        let effects = registry.lock().unwrap().mouse_move(100);
        assert!(catch_unwind(AssertUnwindSafe(|| effects.dispatch())).is_err());
        assert!(registry.lock().is_ok());
    }

    #[test]
    fn removing_an_unexpected_overlay_invalidates_its_parent_entry() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(10, 100, Geometry::new(10, 2, 58, 32), callbacks(events))
            .unwrap();

        let removed = registry.remove_overlay(100).expect("registered overlay");

        assert_eq!(removed.parent(), 10);
        assert_eq!(removed.overlay(), 100);
        assert!(registry.position(10).is_none());
    }

    #[test]
    fn destroyed_overlay_remains_registered_until_parent_cleanup_commits() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(10, 100, Geometry::new(10, 2, 58, 32), callbacks(events))
            .unwrap();

        assert_eq!(registry.mark_overlay_destroyed(100), Some(10));
        let position = registry
            .position(10)
            .expect("failed parent cleanup must remain retryable");
        assert!(!position.overlay_live());

        let removed = registry
            .remove_parent(10)
            .expect("successful parent cleanup commits registry removal");
        assert_eq!(removed.parent(), 10);
        assert!(registry.position(10).is_none());
    }

    #[test]
    fn position_is_an_owned_snapshot_of_the_geometry() {
        let mut registry = Registry::default();
        let events = Arc::new(Mutex::new(Vec::new()));
        registry
            .insert(10, 100, Geometry::new(10, 2, 58, 32), callbacks(events))
            .unwrap();

        let position = registry.position(10).unwrap();
        let _removed = registry.remove_parent(10).unwrap();

        assert_eq!(position.overlay(), 100);
        assert_eq!(position.x(), 10);
        assert_eq!(position.y(), 2);
        assert_eq!(position.width(), 58);
        assert_eq!(position.height(), 32);
    }

    #[test]
    fn event_bridge_preserves_pointer_state_across_sequential_drains() {
        let bridge = EventBridge::new();

        bridge.publish(SnapEvent::MouseEnter);
        let snapshot = bridge.take();
        assert!(snapshot.hovered());
        assert!(!snapshot.pressed());
        assert_eq!(snapshot.clicks(), 0);

        bridge.publish(SnapEvent::MouseDown);
        let snapshot = bridge.take();
        assert!(snapshot.hovered());
        assert!(snapshot.pressed());
        assert_eq!(snapshot.clicks(), 0);

        bridge.publish(SnapEvent::MouseUp);
        bridge.publish(SnapEvent::Click);
        let snapshot = bridge.take();
        assert!(snapshot.hovered());
        assert!(!snapshot.pressed());
        assert_eq!(snapshot.clicks(), 1);

        bridge.publish(SnapEvent::MouseLeave);
        let snapshot = bridge.take();
        assert!(!snapshot.hovered());
        assert!(!snapshot.pressed());
        assert_eq!(snapshot.clicks(), 0);
    }

    #[test]
    fn removed_callbacks_can_close_the_event_bridge() {
        let bridge = Arc::new(EventBridge::new());
        let callback_bridge = bridge.clone();
        let callbacks =
            Callbacks::with_close(Arc::new(|_| {}), Arc::new(move || callback_bridge.close()));
        let mut registry = Registry::default();
        registry
            .insert(10, 100, Geometry::new(10, 2, 58, 32), callbacks)
            .unwrap();

        let removed = registry.remove_parent(10).expect("registered overlay");
        removed.close();

        assert!(bridge.is_closed());
    }

    #[test]
    fn native_event_names_are_closed_over_the_frontend_dispatcher_contract() {
        assert_eq!(SnapEvent::MouseEnter.as_str(), "snap-mouseenter");
        assert_eq!(SnapEvent::MouseLeave.as_str(), "snap-mouseleave");
        assert_eq!(SnapEvent::MouseDown.as_str(), "snap-mousedown");
        assert_eq!(SnapEvent::MouseUp.as_str(), "snap-mouseup");
        assert_eq!(SnapEvent::Click.as_str(), "snap-click");
    }
}
