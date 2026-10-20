use std::{
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::{Duration, Instant},
};

use objc2::{
    ClassType, MainThreadMarker, MainThreadOnly, msg_send,
    rc::Retained,
    runtime::{AnyObject, AnyProtocol, ClassBuilder, Sel},
    sel,
};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSEventMask, NSView, NSWindow, NSWindowButton,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSDate, NSDefaultRunLoopMode, NSNotification, NSObject, NSPoint, NSRect, NSSize, ns_string};

static FORWARDED: AtomicUsize = AtomicUsize::new(0);
static QUEUED_EXIT: AtomicBool = AtomicBool::new(false);
static COMPLETED: AtomicUsize = AtomicUsize::new(0);

extern "C-unwind" fn original(delegate: &AnyObject, selector: Sel, argument: &AnyObject) {
    FORWARDED.fetch_add(1, Ordering::SeqCst);
    if selector == sel!(windowDidEnterFullScreen:) || selector == sel!(windowDidExitFullScreen:) {
        COMPLETED.fetch_add(1, Ordering::SeqCst);
    }
    if selector == sel!(windowDidEnterFullScreen:) && QUEUED_EXIT.swap(false, Ordering::SeqCst) {
        unsafe {
            let _: () = msg_send![delegate, windowWillExitFullScreen: argument];
        }
    }
}

fn visibility(window: &NSWindow) -> [bool; 3] {
    [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton]
        .map(|kind| window.standardWindowButton(kind).expect("Titled window control").isHidden())
}

fn dispatch(delegate: &AnyObject, window: &NSWindow, selector: Sel) {
    let failed = selector == sel!(windowDidFailToEnterFullScreen:) || selector == sel!(windowDidFailToExitFullScreen:);
    unsafe {
        let notification = NSNotification::notificationWithName_object(ns_string!("Control regression"), Some(window));
        let argument: &AnyObject = if failed { window } else { &notification };
        let implementation = delegate.class().instance_method(selector).expect("Decorated callback").implementation();
        let callback: unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) = std::mem::transmute(implementation);
        callback(delegate, selector, argument);
    }
}

fn verify_zoom_alignment(window: &NSWindow, mtm: MainThreadMarker) {
    window.setStyleMask(window.styleMask() | NSWindowStyleMask::FullSizeContentView);
    // Wry replaces Tao's content view. The test must exercise the replacement,
    // rather than accidentally depending on Tao's original drawRect callback.
    let content = NSView::new(mtm);
    window.setContentView(Some(&content));
    let kinds = [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton];
    let original = kinds.map(|kind| window.standardWindowButton(kind).unwrap().frame());
    for zoom in [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] {
        for size in [NSSize::new(640.0, 480.0), NSSize::new(900.0, 700.0)] {
            window.setContentSize(size);
            crate::controls::align_native(window, 16.0 * zoom).unwrap();
            window.setTitle(ns_string!("Traffic-light alignment regression"));
            crate::controls::align_native(window, 16.0 * zoom).unwrap();
            let content = window.contentView().unwrap();
            let content_rect = content.convertRect_toView(content.bounds(), None);
            let top = content_rect.origin.y + content_rect.size.height;
            for (kind, original) in kinds.into_iter().zip(original) {
                let button = window.standardWindowButton(kind).unwrap();
                let rect = button.convertRect_toView(button.bounds(), None);
                let center = top - rect.origin.y - rect.size.height / 2.0;
                assert!((center - 16.0 * zoom).abs() < 0.01, "{kind:?}: zoom={zoom}, actual={center}");
                assert_eq!(button.frame().size, original.size, "Native button size is unchanged");
                assert_eq!(button.frame().origin.x, original.origin.x, "Native button spacing is unchanged");
            }
        }
    }
    println!("PASS: native control centers at all 11 zoom levels, two window sizes and content-view replacement");
}

pub fn run() {
    let mtm = MainThreadMarker::new().expect("Native regression main thread");
    let app = NSApplication::sharedApplication(mtm);
    let _plugin = crate::controls::init();
    let mut builder = ClassBuilder::new(c"AlwithFullscreenRegressionDelegate", NSObject::class()).unwrap();
    builder.add_protocol(AnyProtocol::get(c"NSWindowDelegate").unwrap());
    for selector in [
        sel!(windowWillEnterFullScreen:),
        sel!(windowWillExitFullScreen:),
        sel!(windowDidEnterFullScreen:),
        sel!(windowDidExitFullScreen:),
        sel!(windowDidFailToEnterFullScreen:),
        sel!(windowDidUpdate:),
        sel!(windowWillClose:),
    ] {
        unsafe {
            builder.add_method(selector, original as extern "C-unwind" fn(_, _, _));
        }
    }
    let class = builder.register();
    let delegate: Retained<AnyObject> = unsafe { msg_send![class, new] };
    let make_window = || {
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(100.0, 100.0), NSSize::new(640.0, 480.0)),
                NSWindowStyleMask::Titled
                    | NSWindowStyleMask::Closable
                    | NSWindowStyleMask::Miniaturizable
                    | NSWindowStyleMask::Resizable,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe {
            let _: () = msg_send![&*window, setDelegate: &*delegate];
        }
        crate::controls::prepare(&window);
        window
    };
    let first = make_window();
    let second = make_window();
    second.standardWindowButton(NSWindowButton::MiniaturizeButton).unwrap().setHidden(true);
    let baseline = visibility(&first);
    let second_baseline = visibility(&second);
    verify_zoom_alignment(&first, mtm);
    assert_eq!(baseline, [false; 3]);
    assert_eq!(second_baseline, [false, true, false]);

    for (start, end) in [
        (sel!(windowWillEnterFullScreen:), sel!(windowDidEnterFullScreen:)),
        (sel!(windowWillExitFullScreen:), sel!(windowDidExitFullScreen:)),
        (sel!(windowWillEnterFullScreen:), sel!(windowDidFailToEnterFullScreen:)),
        (sel!(windowWillExitFullScreen:), sel!(windowDidFailToExitFullScreen:)),
    ] {
        dispatch(&delegate, &first, start);
        dispatch(&delegate, &first, start);
        assert_eq!(visibility(&first), [true; 3], "Hidden during transition");
        assert_eq!(visibility(&second), second_baseline, "Independent window state");
        first.standardWindowButton(NSWindowButton::ZoomButton).unwrap().setHidden(false);
        dispatch(&delegate, &first, sel!(windowDidUpdate:));
        assert_eq!(visibility(&first), [true; 3], "AppKit redraw cannot expose controls");
        dispatch(&delegate, &first, end);
        assert_eq!(visibility(&first), baseline, "Completion/failure restores controls");
    }
    dispatch(&delegate, &second, sel!(windowWillEnterFullScreen:));
    dispatch(&delegate, &second, sel!(windowDidEnterFullScreen:));
    assert_eq!(visibility(&second), second_baseline, "Preserve originally hidden controls");
    QUEUED_EXIT.store(true, Ordering::SeqCst);
    dispatch(&delegate, &first, sel!(windowWillEnterFullScreen:));
    dispatch(&delegate, &first, sel!(windowDidEnterFullScreen:));
    assert_eq!(visibility(&first), [true; 3], "Queued exit remains hidden after entry completes");
    dispatch(&delegate, &first, sel!(windowDidExitFullScreen:));
    assert_eq!(visibility(&first), baseline);
    assert!(FORWARDED.load(Ordering::SeqCst) >= 20, "Original delegate handlers still run");
    if std::env::args().any(|arg| arg == "--animate") {
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
        app.finishLaunching();
        first.setTitle(ns_string!("ALwith U fullscreen control regression"));
        first.setCollectionBehavior(NSWindowCollectionBehavior::FullScreenPrimary);
        first.makeKeyAndOrderFront(None);
        for _ in 0..2 {
            let expected = COMPLETED.load(Ordering::SeqCst) + 1;
            first.toggleFullScreen(None);
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut hidden = false;
            while COMPLETED.load(Ordering::SeqCst) < expected {
                assert!(Instant::now() < deadline, "Native fullscreen animation timed out");
                hidden |= visibility(&first) == [true; 3];
                let event = unsafe {
                    app.nextEventMatchingMask_untilDate_inMode_dequeue(
                        NSEventMask::Any,
                        Some(&NSDate::dateWithTimeIntervalSinceNow(0.02)),
                        NSDefaultRunLoopMode,
                        true,
                    )
                };
                if let Some(event) = event {
                    app.sendEvent(&event);
                }
                app.updateWindows();
            }
            assert!(hidden, "Controls hidden during real AppKit animation");
            assert_eq!(visibility(&first), baseline, "Controls restored after real AppKit animation");
        }
        first.orderOut(None);
        println!("PASS: real macOS fullscreen entry and exit animations");
    }
    first.setDelegate(None);
    second.setDelegate(None);
    println!(
        "PASS: AppKit enter/exit, failures, redraw, repeated transitions, two windows, original visibility and queued exit"
    );
}
