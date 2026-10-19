//! Keep native titlebar controls hidden until AppKit finishes a fullscreen transition.
//! Decorate the existing delegate rather than replacing Tao's window state machinery.

use std::{cell::RefCell, collections::HashMap};

use objc2::{
    MainThreadMarker, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use objc2_app_kit::{NSWindow, NSWindowButton};
use tauri::{
    Manager,
    plugin::{Builder, TauriPlugin},
};

type Visibility = [Option<bool>; 3];
type OriginalMethods = HashMap<Sel, Option<Imp>>;
thread_local! {
    static TRANSITIONS: RefCell<HashMap<usize, Visibility>> = RefCell::default();
    static DELEGATES: RefCell<HashMap<usize, OriginalMethods>> = RefCell::default();
}

const BUTTONS: [NSWindowButton; 3] =
    [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton];

fn window_key(window: &NSWindow) -> usize {
    window as *const NSWindow as usize
}

fn begin(window: &NSWindow) {
    let visibility = BUTTONS.map(|kind| window.standardWindowButton(kind).map(|button| button.isHidden()));
    if visibility.iter().all(Option::is_none) {
        return;
    }
    TRANSITIONS.with_borrow_mut(|states| {
        states.entry(window_key(window)).or_insert(visibility);
    });
    hide(window);
}

fn hide(window: &NSWindow) {
    if !TRANSITIONS.with_borrow(|states| states.contains_key(&window_key(window))) {
        return;
    }
    for kind in BUTTONS {
        if let Some(button) = window.standardWindowButton(kind)
            && !button.isHidden()
        {
            button.setHidden(true);
        }
    }
}

fn finish(window: &NSWindow) {
    let previous = TRANSITIONS.with_borrow_mut(|states| states.remove(&window_key(window)));
    if let Some(previous) = previous {
        for (kind, hidden) in BUTTONS.into_iter().zip(previous) {
            if let (Some(hidden), Some(button)) = (hidden, window.standardWindowButton(kind)) {
                button.setHidden(hidden);
            }
        }
    }
}

fn registered_class(mut class: &AnyClass) -> Option<usize> {
    loop {
        let key = class as *const AnyClass as usize;
        if DELEGATES.with_borrow(|delegates| delegates.contains_key(&key)) {
            return Some(key);
        }
        class = class.superclass()?;
    }
}

extern "C-unwind" fn transition(delegate: &AnyObject, selector: Sel, argument: &AnyObject) {
    MainThreadMarker::new().expect("AppKit window delegate runs on the main thread");
    let failed = selector == sel!(windowDidFailToEnterFullScreen:) || selector == sel!(windowDidFailToExitFullScreen:);
    // Failure callbacks receive NSWindow; the other callbacks receive NSNotification.
    let window: &NSWindow = unsafe {
        if failed {
            &*(argument as *const AnyObject as *const NSWindow)
        } else {
            let pointer: *const NSWindow = msg_send![argument, object];
            &*pointer
        }
    };
    let starting = selector == sel!(windowWillEnterFullScreen:) || selector == sel!(windowWillExitFullScreen:);
    if starting {
        begin(window);
    } else if failed || selector == sel!(windowDidEnterFullScreen:) || selector == sel!(windowDidExitFullScreen:) {
        // Tao may start a retry or queued transition from completion. Restore before forwarding it.
        finish(window);
    }
    let key = registered_class(delegate.class()).expect("Decorated window delegate");
    let original = DELEGATES.with_borrow(|delegates| delegates[&key][&selector]);
    if let Some(original) = original {
        // SAFETY: all decorated methods have the Objective-C void(id, SEL, id) ABI.
        let call: unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) = unsafe { std::mem::transmute(original) };
        unsafe { call(delegate, selector, argument) };
    }
    if starting || selector == sel!(windowDidUpdate:) {
        hide(window);
    } else if selector == sel!(windowWillClose:) {
        TRANSITIONS.with_borrow_mut(|states| states.remove(&window_key(window)));
    }
}

pub(crate) fn prepare(window: &NSWindow) {
    MainThreadMarker::new().expect("Prepare native window controls on the main thread");
    let Some(delegate) = window.delegate() else { return };
    let object: &AnyObject = delegate.as_ref();
    let class = object.class();
    if registered_class(class).is_some() {
        return;
    }
    let mut originals = HashMap::new();
    for selector in [
        sel!(windowWillEnterFullScreen:),
        sel!(windowWillExitFullScreen:),
        sel!(windowDidEnterFullScreen:),
        sel!(windowDidExitFullScreen:),
        sel!(windowDidFailToEnterFullScreen:),
        sel!(windowDidFailToExitFullScreen:),
        sel!(windowDidUpdate:),
        sel!(windowWillClose:),
    ] {
        let method = class.instance_method(selector);
        originals.insert(selector, method.map(|method| method.implementation()));
        // Add an override for inherited/missing methods; never mutate NSObject's implementation.
        // SAFETY: the replacement preserves the method ABI and forwards the retained original IMP.
        unsafe {
            let replacement: Imp = std::mem::transmute(transition as extern "C-unwind" fn(_, _, _));
            if !objc2::ffi::class_addMethod(
                class as *const AnyClass as *mut AnyClass,
                selector,
                replacement,
                c"v@:@".as_ptr(),
            )
            .as_bool()
            {
                method.expect("Existing delegate method").set_implementation(replacement);
            }
        }
    }
    DELEGATES.with_borrow_mut(|delegates| delegates.insert(class as *const AnyClass as usize, originals));
    // Refresh AppKit's cached optional delegate capabilities, including failure-to-exit.
    window.setDelegate(None);
    window.setDelegate(Some(&delegate));
}

pub fn init() -> TauriPlugin<tauri::DynRuntime> {
    Builder::new("fullscreen-controls")
        .on_window_ready(|window| {
            let handle = window.clone();
            if let Err(error) = window.run_on_main_thread(move || match handle.ns_window() {
                Ok(pointer) => {
                    // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
                    let native = unsafe { &*(pointer as *const NSWindow) };
                    prepare(native);
                    if handle.label() == "main" {
                        let close = native
                            .standardWindowButton(NSWindowButton::CloseButton)
                            .expect("Main window has native controls");
                        let frame = close.frame();
                        // Tao sets the titlebar height to button height + inset while retaining the button's local origin.
                        // Match the center of the host's 32px toolbar without assuming AppKit's button dimensions.
                        let inset = 16.0 + frame.origin.y - frame.size.height / 2.0;
                        if let Err(error) = handle.set_traffic_light_position(tauri::Position::Logical(
                            tauri::LogicalPosition::new(frame.origin.x, inset),
                        )) {
                            log::error!("Cannot align native window controls: {error}");
                        }
                    }
                }
                Err(error) => log::error!("Cannot prepare fullscreen controls: {error}"),
            }) {
                log::error!("Cannot schedule fullscreen controls: {error}");
            }
        })
        .build()
}
