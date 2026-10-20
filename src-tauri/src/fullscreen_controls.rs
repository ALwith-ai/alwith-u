//! Keep native titlebar controls hidden until AppKit finishes a fullscreen transition.
//! Decorate the existing delegate rather than replacing Tao's window state machinery.

use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use objc2::{
    MainThreadMarker, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::NSPoint;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

type Visibility = [Option<bool>; 3];
type OriginalMethods = HashMap<Sel, Option<Imp>>;
thread_local! {
    static MAIN_WINDOW: Cell<Option<usize>> = const { Cell::new(None) };
    static TRANSITIONS: RefCell<HashMap<usize, Visibility>> = RefCell::default();
    static DELEGATES: RefCell<HashMap<usize, OriginalMethods>> = RefCell::default();
}

const BUTTONS: [NSWindowButton; 3] =
    [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton];
static TRAFFIC_LIGHT_CENTER_Y: AtomicU64 = AtomicU64::new(16.0f64.to_bits());

fn traffic_light_center_y() -> f64 {
    f64::from_bits(TRAFFIC_LIGHT_CENTER_Y.load(Ordering::Relaxed))
}

pub(crate) fn align_native(window: &NSWindow, center_y: f64) -> Result<(), String> {
    MainThreadMarker::new().expect("Align native controls on the main thread");
    if window.styleMask().contains(NSWindowStyleMask::FullScreen)
        || TRANSITIONS.with_borrow(|states| states.contains_key(&window_key(window)))
    {
        return Ok(());
    }
    let close = window.standardWindowButton(NSWindowButton::CloseButton).ok_or("Main window has no close button")?;
    // SAFETY: AppKit owns these retained views; the window is alive on its main thread.
    let parent = unsafe { close.superview() }.ok_or("Native controls have no container")?;
    let titlebar = unsafe { parent.superview() }.ok_or("Native controls have no titlebar")?;
    let content = window.contentView().ok_or("Main window has no content view")?;
    let content_rect = content.convertRect_toView(content.bounds(), None);
    let top = content_rect.origin.y + content_rect.size.height;
    let height = center_y * 2.0;
    let mut frame = titlebar.frame();
    let titlebar_parent = unsafe { titlebar.superview() }.ok_or("Native titlebar has no parent")?;
    let target = titlebar_parent.convertPoint_fromView(NSPoint::new(0.0, top - center_y), None);
    let origin_y = target.y - height / 2.0;
    if (frame.size.height - height).abs() > 0.01 || (frame.origin.y - origin_y).abs() > 0.01 {
        frame.size.height = height;
        frame.origin.y = origin_y;
        titlebar.setFrame(frame);
        titlebar.layoutSubtreeIfNeeded();
    }
    for kind in BUTTONS {
        let button = window.standardWindowButton(kind).ok_or("Main window has incomplete native controls")?;
        // SAFETY: Same live AppKit hierarchy and main-thread guarantee as above.
        let parent = unsafe { button.superview() }.ok_or("Native control has no container")?;
        // Convert through the actual AppKit hierarchy: its intermediate views and
        // flipped coordinate systems can change when macOS lays out the titlebar.
        let target = parent.convertPoint_fromView(NSPoint::new(0.0, top - center_y), None);
        let mut frame = button.frame();
        let y = target.y - frame.size.height / 2.0;
        if (frame.origin.y - y).abs() > 0.01 {
            frame.origin.y = y;
            button.setFrameOrigin(frame.origin);
        }
    }
    Ok(())
}

fn align_main_window<R: Runtime>(window: &tauri::Window<R>) {
    if window.label() != "main" {
        return;
    }
    let handle = window.clone();
    if let Err(error) = window.run_on_main_thread(move || {
        let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
            // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
            align_native(unsafe { &*(pointer as *const NSWindow) }, traffic_light_center_y())
        });
        if let Err(error) = result {
            log::error!("Cannot align native window controls: {error}");
        }
    }) {
        log::error!("Cannot schedule traffic-light alignment: {error}");
    }
}

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
        MAIN_WINDOW.with(|main| {
            if main.get() == Some(window_key(window)) {
                main.set(None);
            }
        });
    }
    if !starting
        && MAIN_WINDOW.with(|main| main.get() == Some(window_key(window)))
        && let Err(error) = align_native(window, traffic_light_center_y())
    {
        log::error!("Cannot restore native control alignment: {error}");
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
                        MAIN_WINDOW.with(|main| main.set(Some(window_key(native))));
                        if let Err(error) = align_native(native, traffic_light_center_y()) {
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

/// Keep native controls centered in the zoomed webview toolbar.
#[tauri::command]
pub async fn set_traffic_light_zoom(window: tauri::WebviewWindow, zoom: f64) -> Result<(), String> {
    if !zoom.is_finite() || zoom <= 0.0 {
        return Err("Window zoom must be a positive finite number".into());
    }
    if window.label() != "main" {
        return Ok(());
    }
    let center_y = 16.0 * zoom;
    TRAFFIC_LIGHT_CENTER_Y.store(center_y.to_bits(), Ordering::Relaxed);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = handle.ns_window().map_err(|error| error.to_string()).and_then(|pointer| {
                // SAFETY: the live Tauri window is retained and accessed on AppKit's main thread.
                let native = unsafe { &*(pointer as *const NSWindow) };
                align_native(native, center_y)?;
                let close =
                    native.standardWindowButton(NSWindowButton::CloseButton).expect("Aligned native close button");
                let rect = close.convertRect_toView(close.bounds(), None);
                let content = native.contentView().expect("Aligned content view");
                let content_rect = content.convertRect_toView(content.bounds(), None);
                let top = content_rect.origin.y + content_rect.size.height;
                log::debug!(
                    "Traffic-light zoom {zoom}: target center {center_y}, native center {}",
                    top - rect.origin.y - rect.size.height / 2.0
                );
                Ok(())
            });
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

/// Re-align after the packaged app restores its native window geometry or display scale.
pub(crate) fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
            | tauri::WindowEvent::Focused(true)
            | tauri::WindowEvent::Moved(_)
    ) {
        return;
    }
    align_main_window(window);
}
