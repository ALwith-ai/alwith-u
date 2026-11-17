//! AppKit contracts run on the process main thread, without an agent or a user profile.
#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{ClassType, MainThreadMarker, rc::Retained, runtime::ClassBuilder};
    use objc2_app_kit::{
        NSApplication, NSBackingStoreType, NSGlassEffectView, NSPanel, NSView, NSWindow, NSWindowStyleMask,
    };
    use objc2_foundation::{NSObject, NSPoint, NSRect, NSSize};
    use tauri_nspanel::window_effects::DetachedWindowEffects;

    unsafe extern "C" {
        fn object_setClass(
            object: *mut NSObject, class: *const objc2::runtime::AnyClass,
        ) -> *const objc2::runtime::AnyClass;
        fn object_getClass(object: *mut NSObject) -> *const objc2::runtime::AnyClass;
    }

    let mtm = MainThreadMarker::new().expect("Native contracts require the main thread");
    let _application = NSApplication::sharedApplication(mtm);
    let panel_class = ClassBuilder::new(c"AlwithPanelEffectsContractPanel", NSPanel::class())
        .expect("Unique contract panel class")
        .register();
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 300.0));

    for nested in [false, true] {
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                mtm.alloc(),
                frame,
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        // SAFETY: The retained test window is released by ARC, never independently by AppKit.
        unsafe { window.setReleasedWhenClosed(false) };
        let root = window.contentView().expect("Window content");
        let container = if nested {
            let container = NSView::initWithFrame(mtm.alloc(), frame);
            root.addSubview(&container);
            container
        } else {
            root
        };
        let host = NSView::initWithFrame(mtm.alloc(), frame);
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
        let front_glass = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
        container.addSubview(&glass);
        container.addSubview(&host);
        container.addSubview(&front_glass);
        let original_order = container.subviews().to_vec();
        let native = Retained::as_ptr(&window).cast_mut().cast::<NSObject>();

        let effects = DetachedWindowEffects::new(&window);
        assert_eq!(container.subviews().to_vec(), vec![host.clone()]);
        assert!(host.window().is_some(), "The webview host must remain attached");
        assert!(glass.window().is_none());
        assert!(front_glass.window().is_none());
        // SAFETY: Match the adapter's class change while all effect observers are detached.
        let original_class = unsafe { object_getClass(native) };
        unsafe { object_setClass(native, panel_class) };
        drop(effects);
        assert_eq!(container.subviews().to_vec(), original_order, "Panel conversion must preserve stacking order");
        assert_eq!(glass.frame(), frame);
        assert_eq!(front_glass.frame(), frame);

        // Updating an effect must unregister its observers successfully after conversion.
        glass.removeFromSuperview();
        container.addSubview(&glass);
        let panel_order = container.subviews().to_vec();
        let effects = DetachedWindowEffects::new(&window);
        unsafe { object_setClass(native, original_class) };
        drop(effects);
        assert_eq!(container.subviews().to_vec(), panel_order, "Window restoration must preserve stacking order");
        glass.removeFromSuperview();
        front_glass.removeFromSuperview();
        assert!(host.window().is_some());
    }
    println!(
        "Panel effect contracts passed: direct and nested views, both class changes, host retention and stacking order"
    );
}
