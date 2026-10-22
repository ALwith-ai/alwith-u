//! Observe the main window content view without changing its superclass chain.
//! Wry 0.57 replaces TaoView with WryWebViewParent for a non-child webview.
//! Each observer forwards to the superclass captured during installation.

use std::cell::RefCell;
use std::ffi::CString;
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{ffi, msg_send, sel};
use objc2_app_kit::{NSEvent, NSTouchPhase, NSTouchTypeMask, NSView, NSWindow};
use tauri::{AppHandle, Manager};

use super::{Machine, TouchFrame, aggregate, emit_gesture};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

thread_local! {

    static MACHINE: RefCell<Machine> = RefCell::new(Machine::new());
}

static MAIN_VIEW: OnceLock<usize> = OnceLock::new();

static SUPERCLASS: OnceLock<&'static AnyClass> = OnceLock::new();

pub fn reset() {
    MACHINE.with(|machine| *machine.borrow_mut() = Machine::new());
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    APP_HANDLE.set(app.clone()).expect("trackpad gestures installed twice");
    let main = app.get_webview_window("main").expect("main window exists at setup");
    let ns_window = main.ns_window()? as *mut NSWindow;
    let content = unsafe { (*ns_window).contentView() }.expect("main window has contentView");

    let class_name = content.class().name().to_string_lossy();
    let supported = class_name == "TaoView"
        || class_name.starts_with("wry::wkwebview::class::wry_web_view_parent::WryWebViewParent");
    if !supported {
        return Err(format!("Unsupported trackpad content view: {}", content.class().name().to_string_lossy()).into());
    }
    // Only the main content view opts in; WKWebView retains its usual input path.
    content.setAllowedTouchTypes(NSTouchTypeMask::Indirect);
    MAIN_VIEW.set((&*content as *const NSView) as usize).expect("main view installed once");
    unsafe { add_touch_methods(&content) };
    Ok(())
}

unsafe fn add_touch_methods(view: &NSView) {
    let obj: &AnyObject = view.as_ref();
    let cls = obj.class();
    SUPERCLASS.set(cls.superclass().expect("content view class has superclass")).expect("add_touch_methods ran twice");

    let types = CString::new("v@:@").expect("cstring");
    let methods: [(Sel, extern "C-unwind" fn(&AnyObject, Sel, &NSEvent)); 4] = [
        (sel!(touchesBeganWithEvent:), touches_began),
        (sel!(touchesMovedWithEvent:), touches_moved),
        (sel!(touchesEndedWithEvent:), touches_ended),
        (sel!(touchesCancelledWithEvent:), touches_cancelled),
    ];
    for (sel, imp) in methods {
        let added = unsafe {
            ffi::class_addMethod(
                cls as *const AnyClass as *mut AnyClass,
                sel,
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &NSEvent), Imp>(imp),
                types.as_ptr(),
            )
        };
        assert!(added.as_bool(), "content view class already implements {sel}");
    }
}

fn observe_and_emit(view: &AnyObject, event: &NSEvent) {
    if Some(&((view as *const AnyObject) as usize)) != MAIN_VIEW.get() {
        return;
    }
    let Some(frame) = observe(event) else { return };
    let Some(out) = MACHINE.with(|m| m.borrow_mut().step(&frame)) else { return };
    emit_gesture(APP_HANDLE.get().expect("install ran"), out);
}

extern "C-unwind" fn touches_began(this: &AnyObject, _cmd: Sel, event: &NSEvent) {
    observe_and_emit(this, event);
    let sup = *SUPERCLASS.get().expect("install ran");
    unsafe {
        let _: () = msg_send![super(this, sup), touchesBeganWithEvent: event];
    };
}

extern "C-unwind" fn touches_moved(this: &AnyObject, _cmd: Sel, event: &NSEvent) {
    observe_and_emit(this, event);
    let sup = *SUPERCLASS.get().expect("install ran");
    unsafe {
        let _: () = msg_send![super(this, sup), touchesMovedWithEvent: event];
    };
}

extern "C-unwind" fn touches_ended(this: &AnyObject, _cmd: Sel, event: &NSEvent) {
    observe_and_emit(this, event);
    let sup = *SUPERCLASS.get().expect("install ran");
    unsafe {
        let _: () = msg_send![super(this, sup), touchesEndedWithEvent: event];
    };
}

extern "C-unwind" fn touches_cancelled(this: &AnyObject, _cmd: Sel, event: &NSEvent) {
    observe_and_emit(this, event);
    let sup = *SUPERCLASS.get().expect("install ran");
    unsafe {
        let _: () = msg_send![super(this, sup), touchesCancelledWithEvent: event];
    };
}

fn observe(ev: &NSEvent) -> Option<TouchFrame> {
    let touches = ev.touchesMatchingPhase_inView(NSTouchPhase::Any, None);
    if touches.count() == 0 {
        return None;
    }
    let mut cancelled = 0usize;
    let mut positions: Vec<(f64, f64)> = Vec::with_capacity(touches.count());
    let mut device = (0.0f64, 0.0f64);
    for touch in touches.iter() {
        let phase = touch.phase();
        if phase.contains(NSTouchPhase::Cancelled) {
            cancelled += 1;
        } else if phase.intersects(NSTouchPhase::Touching) {
            let p = touch.normalizedPosition();

            positions.push((p.x, 1.0 - p.y));
            let s = touch.deviceSize();
            device = (s.width, s.height);
        }
    }
    let touching = positions.len();
    let (centroid, spread) = if touching > 0 { aggregate(&positions) } else { ((0.0, 0.0), 0.0) };
    Some(TouchFrame { touching, cancelled, centroid, spread, ts: ev.timestamp(), device: Some(device) })
}
