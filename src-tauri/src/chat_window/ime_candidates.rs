//! Attach system IME candidate windows left in an old Space to the current chat panel.
//! See docs/fallbacks.md for this AppKit compatibility workaround and its removal criteria.

use std::cell::{Cell, RefCell};

use objc2::{
    ClassType, MainThreadMarker, MainThreadOnly, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ClassBuilder, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSTextInputContext, NSWindow, NSWindowCollectionBehavior, NSWindowOrderingMode};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol};

struct CandidateBinding {
    candidate: Retained<NSWindow>,
    parent: Retained<NSWindow>,
    window_number: isize,
    original_level: isize,
    original_behavior: NSWindowCollectionBehavior,
}

impl CandidateBinding {
    fn is_our_child(&self) -> bool {
        self.candidate.parentWindow().is_some_and(|parent| std::ptr::eq(&*parent, &*self.parent))
    }

    fn detach(&self) {
        // The system may have reclaimed or reparented the candidate window; detach only relationships we still own.
        if self.is_our_child() {
            self.parent.removeChildWindow(&self.candidate);
            // addChildWindow changes the level and IgnoresCycle; restore their original values when returning control to the system.
            self.candidate.setLevel(self.original_level);
            self.candidate.setCollectionBehavior(self.original_behavior);
            log::debug!(
                "[overlay-ime] detached candidate={} parent={}",
                self.window_number,
                self.parent.windowNumber()
            );
        }
    }
}

thread_local! {
    static BINDINGS: RefCell<Vec<CandidateBinding>> = const { RefCell::new(Vec::new()) };
    static UPDATING: Cell<bool> = const { Cell::new(false) };
}

struct UpdateGuard;

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.set(false);
    }
}

fn with_bindings(action: impl FnOnce(&mut Vec<CandidateBinding>)) {
    MainThreadMarker::new().expect("IME candidate ownership requires the main thread");
    // AppKit parent/child window operations may post notifications synchronously; this outer update handles nested notifications.
    if UPDATING.replace(true) {
        return;
    }
    let _guard = UpdateGuard;
    BINDINGS.with_borrow_mut(action);
}

pub(super) fn install() {
    MainThreadMarker::new().expect("IME candidate observer requires the main thread");
    let mut builder = ClassBuilder::new(c"AlwithImeCandidateObserver", NSObject::class())
        .expect("IME candidate observer must be installed once");
    // SAFETY: The selector matches the callback signature; the observer lives until app exit and only accesses AppKit objects on the main thread.
    unsafe {
        builder.add_method(sel!(updateOverlayCandidates:), notification as extern "C-unwind" fn(_, _, _));
        builder.add_method(sel!(closeOverlayCandidates:), window_will_close as extern "C-unwind" fn(_, _, _));
        builder.add_method(sel!(clearOverlayCandidates:), application_will_terminate as extern "C-unwind" fn(_, _, _));
        let class = builder.register();
        let observer: *mut AnyObject = msg_send![class, new];
        assert!(!observer.is_null(), "Unable to allocate IME candidate observer");
        let center = NSNotificationCenter::defaultCenter();
        for name in [
            objc2_app_kit::NSApplicationDidUpdateNotification,
            objc2_app_kit::NSApplicationDidResignActiveNotification,
            objc2_app_kit::NSWindowDidBecomeKeyNotification,
            objc2_app_kit::NSWindowDidResignKeyNotification,
        ] {
            let _: () = msg_send![&*center, addObserver: observer,
                selector: sel!(updateOverlayCandidates:), name: name, object: std::ptr::null::<AnyObject>()];
        }
        let _: () = msg_send![&*center, addObserver: observer,
            selector: sel!(closeOverlayCandidates:), name: objc2_app_kit::NSWindowWillCloseNotification,
            object: std::ptr::null::<AnyObject>()];
        let _: () = msg_send![&*center, addObserver: observer,
            selector: sel!(clearOverlayCandidates:), name: objc2_app_kit::NSApplicationWillTerminateNotification,
            object: std::ptr::null::<AnyObject>()];
    }
    log::debug!("[overlay-ime] candidate ownership observer installed");
}

extern "C-unwind" fn notification(_observer: &AnyObject, _selector: Sel, _notification: *const NSNotification) {
    update();
}

extern "C-unwind" fn window_will_close(_observer: &AnyObject, _selector: Sel, notification: *const NSNotification) {
    // SAFETY: NSWindowWillCloseNotification's object is the closing window and remains valid during the callback.
    let window: *const NSWindow = unsafe { msg_send![&*notification, object] };
    assert!(!window.is_null(), "Window close notification must identify its window");
    with_bindings(|bindings| {
        bindings.retain(|binding| {
            if std::ptr::eq(&*binding.parent, window) || std::ptr::eq(&*binding.candidate, window) {
                binding.detach();
                false
            } else {
                true
            }
        });
    });
}

extern "C-unwind" fn application_will_terminate(
    _observer: &AnyObject, _selector: Sel, _notification: *const NSNotification,
) {
    with_bindings(|bindings| {
        for binding in bindings.drain(..) {
            binding.detach();
        }
    });
}

fn input_panel(application: &NSApplication) -> Option<Retained<NSWindow>> {
    let window = application.keyWindow()?;
    if !window.isKeyWindow() || !window.isVisible() || !window.isKindOfClass(super::RawDesktopChatPanel::class()) {
        return None;
    }
    // An input context may be absent during focus changes; do not lazily create or activate a new context for the view.
    let context = NSTextInputContext::currentInputContext(application.mtm())?;
    let client = context.client();
    let responder = window.firstResponder()?;
    if (&*client as *const _ as *const ()) != (&*responder as *const _ as *const ()) {
        return None;
    }
    Some(window)
}

pub(super) fn update() {
    let marker = MainThreadMarker::new().expect("IME candidate ownership requires the main thread");
    let application = NSApplication::sharedApplication(marker);
    let input = input_panel(&application);
    with_bindings(|bindings| {
        bindings.retain(|binding| {
            let keep = binding.is_our_child()
                && binding.candidate.isVisible()
                && binding.candidate.windowNumber() == binding.window_number
                && input.as_ref().is_some_and(|window| std::ptr::eq(&**window, &*binding.parent));
            if !keep {
                binding.detach();
            }
            keep
        });
        let Some(parent) = input else { return };
        // ViewBridge candidate window type verified on macOS 26.5; isKindOfClass also recognizes system KVO subclasses.
        // The class may load only when the IME is first used. Match known types only; do not infer other system windows from levels or dimensions.
        // This is a platform compatibility workaround, not a public candidate-window API; its scope and removal criteria are in docs/fallbacks.md.
        let Some(candidate_class) = AnyClass::get(c"NSPanel.ViewBridge.rendezvous") else { return };
        for candidate in application.windows().iter() {
            if !candidate.isKindOfClass(candidate_class)
                || !candidate.isVisible()
                || candidate.isOnActiveSpace()
                || candidate.canBecomeKeyWindow()
                || candidate.canBecomeMainWindow()
                || candidate.parentWindow().is_some()
            {
                continue;
            }
            let binding = CandidateBinding {
                window_number: candidate.windowNumber(),
                original_level: candidate.level(),
                original_behavior: candidate.collectionBehavior(),
                candidate,
                parent: parent.clone(),
            };
            // SAFETY: Both windows belong to this process and are held on the main thread; the candidate has no parent, so no parent/child cycle can form.
            unsafe { parent.addChildWindow_ordered(&binding.candidate, NSWindowOrderingMode::Above) };
            log::debug!("[overlay-ime] attached candidate={} parent={}", binding.window_number, parent.windowNumber());
            bindings.push(binding);
        }
    });
}
