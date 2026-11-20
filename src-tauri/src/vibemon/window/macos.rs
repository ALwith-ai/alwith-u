use super::backdrop;
use std::{cell::OnceCell, ptr::NonNull};

use objc2::{AnyThread, MainThreadMarker, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSEventType, NSScreen, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::Manager;

thread_local! {
    static POINTER_MONITOR: OnceCell<Retained<AnyObject>> = const { OnceCell::new() };
}

fn covers_pointer(frame: NSRect, point: NSPoint, front: isize, source: isize, pet: isize) -> bool {
    source != pet
        && (front == source || front == pet)
        && point.x >= frame.origin.x
        && point.x < frame.origin.x + frame.size.width
        && point.y >= frame.origin.y
        && point.y < frame.origin.y + frame.size.height
}

fn monitor_pointer(host: &tauri::WebviewWindow) -> Result<(), String> {
    POINTER_MONITOR.with(|monitor| {
        if monitor.get().is_some() {
            return Ok(());
        }
        let app = host.app_handle().clone();
        let handler = block2::RcBlock::new(move |event: NonNull<NSEvent>| {
            // AppKit invokes this monitor on its main thread, with a live event and native windows.
            let event_ref = unsafe { event.as_ref() };
            let Some(window) = app.get_webview_window("vibemon") else { return event.as_ptr() };
            let Ok(pointer) = window.ns_window() else { return event.as_ptr() };
            let pet = unsafe { &*(pointer as *const NSWindow) };
            if !pet.isVisible() || pet.ignoresMouseEvents() || event_ref.windowNumber() == pet.windowNumber() {
                return event.as_ptr();
            }
            let point = NSEvent::mouseLocation();
            let Some(marker) = MainThreadMarker::new() else { return event.as_ptr() };
            let front = NSWindow::windowNumberAtPoint_belowWindowWithWindowNumber(point, 0, marker);
            if !covers_pointer(pet.frame(), point, front, event_ref.windowNumber(), pet.windowNumber()) {
                return event.as_ptr();
            }
            let Some(routed) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                NSEventType::MouseMoved,
                pet.convertPointFromScreen(point),
                event_ref.modifierFlags(),
                event_ref.timestamp(),
                pet.windowNumber(),
                None,
                event_ref.eventNumber(),
                0,
                0.0,
            ) else { return event.as_ptr() };
            pet.sendEvent(&routed);
            std::ptr::null_mut()
        });
        // The handler either returns the original event or consumes it after sending a retained replacement.
        let installed = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::MouseMoved, &handler) }
            .ok_or("Could not install Vibemon pointer routing")?;
        monitor.set(installed).map_err(|_| "Vibemon pointer routing already installed".to_owned())
    })
}

fn offscreen_origin(frame: NSRect, visible_frames: &[NSRect], preferred: NSRect) -> Option<NSPoint> {
    let center = NSPoint::new(frame.origin.x + frame.size.width / 2.0, frame.origin.y + frame.size.height / 2.0);
    if visible_frames.iter().any(|area| {
        center.x >= area.origin.x
            && center.x <= area.origin.x + area.size.width
            && center.y >= area.origin.y
            && center.y <= area.origin.y + area.size.height
    }) {
        return None;
    }
    Some(NSPoint::new(preferred.origin.x + preferred.size.width - frame.size.width - 24.0, preferred.origin.y + 90.0))
}

fn ensure_visible(window: &NSWindow) -> Result<(), String> {
    let marker = MainThreadMarker::new().ok_or("Vibemon screen validation requires the main thread")?;
    let screens = NSScreen::screens(marker);
    let preferred = NSScreen::mainScreen(marker).ok_or("Vibemon display unavailable")?;
    let visible_frames: Vec<_> = screens.iter().map(|screen| screen.visibleFrame()).collect();
    // Desktop uses AppKit global points here: Tauri window and monitor physical
    // coordinates use different scale factors on mixed-DPI displays.
    if let Some(origin) = offscreen_origin(window.frame(), &visible_frames, preferred.visibleFrame()) {
        window.setFrameOrigin(origin);
    }
    Ok(())
}

pub(crate) fn repair_position(window: &NSWindow) -> Result<(), String> {
    ensure_visible(window)?;
    if let Some(screen) = window.screen() {
        let area = screen.visibleFrame();
        let frame = window.frame();
        let x = frame
            .origin
            .x
            .clamp(area.origin.x, (area.origin.x + area.size.width - frame.size.width).max(area.origin.x));
        let y = frame
            .origin
            .y
            .clamp(area.origin.y, (area.origin.y + area.size.height - frame.size.height).max(area.origin.y));
        window.setFrameOrigin(NSPoint::new(x, y));
    }
    Ok(())
}

fn bubble_frame(parent: NSRect, size: NSSize, screen: NSRect) -> NSRect {
    let x = (parent.origin.x + (parent.size.width - size.width) / 2.0)
        .clamp(screen.origin.x, (screen.origin.x + screen.size.width - size.width).max(screen.origin.x));
    let above = parent.origin.y + parent.size.height;
    let y =
        if above + size.height <= screen.origin.y + screen.size.height { above } else { parent.origin.y - size.height };
    let y = y.clamp(screen.origin.y, (screen.origin.y + screen.size.height - size.height).max(screen.origin.y));
    NSRect::new(NSPoint::new(x, y), size)
}

fn layout_bubble(window: &NSWindow, parent: &NSWindow, size: NSSize) -> Result<(), String> {
    let screen = parent.screen().ok_or("Vibemon screen unavailable")?.visibleFrame();
    let frame = bubble_frame(parent.frame(), size, screen);
    if window.frame() != frame {
        window.setFrame_display(frame, true);
    }
    Ok(())
}

/// Relayout without changing the bubble's visibility, focus, or parent relationship.
pub(crate) fn repair_bubble_position(window: &NSWindow, parent: &NSWindow) -> Result<(), String> {
    layout_bubble(window, parent, window.frame().size)
}

pub(crate) fn follow_vibemon(app: &tauri::AppHandle) -> Result<(), String> {
    let _main = MainThreadMarker::new().ok_or("Vibemon bubble layout requires the main thread")?;
    let Some(parent) = app.get_webview_window("vibemon") else { return Ok(()) };
    let Some(bubble) = app.get_webview_window("bubble-menu-vibemon") else { return Ok(()) };
    // SAFETY: both live windows are retained on the main thread throughout layout.
    let parent = unsafe { &*parent.ns_window().map_err(|error| error.to_string())?.cast::<NSWindow>() };
    let bubble = unsafe { &*bubble.ns_window().map_err(|error| error.to_string())?.cast::<NSWindow>() };
    if bubble.isVisible() && bubble.parentWindow().as_deref() == Some(parent) {
        repair_bubble_position(bubble, parent)?;
    }
    Ok(())
}

pub(super) fn apply(host: &tauri::WebviewWindow, action: super::WindowAction) -> Result<(), String> {
    let marker = MainThreadMarker::new().ok_or("Vibemon native actions require the main thread")?;
    // SAFETY: the app supplies a retained live NSWindow and executes synchronously on its UI thread.
    let window = unsafe { &*(action.handle as *const NSWindow) };
    match action.action.as_str() {
        "blur" => backdrop::apply(window, action.radius.ok_or("Missing vibemon blur radius")?, action.path)?,
        "focus" => {
            if window.isVisible() {
                window.makeKeyWindow();
            }
        }
        "prepare" => crate::panel::prepare(host)?,
        "sound" => {
            let path = objc2_foundation::NSString::from_str(
                "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/dock/poof item off dock.aif",
            );
            if let Some(sound) =
                objc2_app_kit::NSSound::initWithContentsOfFile_byReference(objc2_app_kit::NSSound::alloc(), &path, true)
            {
                sound.play();
            }
        }
        "forget" => {
            // Destroy bypasses CloseRequested, so undo the AppKit panel conversion here.
            crate::panel::before_close(host.app_handle(), host.label());
        }
        "present" => {
            crate::panel::prepare(host)?;
            crate::panel::set_presented(host.label(), true);
            if action.role == "vibemon" {
                monitor_pointer(host)?;
                ensure_visible(window)?;
            }
            window.orderFrontRegardless();
            if action.role != "vibemon" {
                window.makeKeyWindow();
            }
        }
        "hide" => {
            crate::panel::set_presented(host.label(), false);
            if action.role == "bubble"
                && let Some(parent) = window.parentWindow()
            {
                parent.removeChildWindow(window);
            }
            window.orderOut(None);
        }
        "detach" => {
            if let Some(parent) = window.parentWindow() {
                parent.removeChildWindow(window);
            }
        }
        "bubble" | "bubble-resize" => {
            let pointer = action.parent.ok_or("Bubble parent unavailable")?;
            if pointer == 0 {
                return Err("Bubble parent unavailable".into());
            }
            let parent = unsafe { &*(pointer as *const NSWindow) };
            let size = action.width.zip(action.height).map_or(window.frame().size, |(w, h)| NSSize::new(w, h));
            layout_bubble(window, parent, size)?;
            if action.action == "bubble" {
                crate::panel::prepare(host)?;
                unsafe {
                    if let Some(previous) = window.parentWindow() {
                        previous.removeChildWindow(window);
                    }
                    parent.addChildWindow_ordered(window, NSWindowOrderingMode::Above);
                }
                crate::panel::set_presented(host.label(), true);
                window.orderFrontRegardless();
            }
        }
        "drag" => {
            let app = NSApplication::sharedApplication(marker);
            if NSEvent::pressedMouseButtons() & 1 == 0 {
                return Ok(());
            }
            let event = app.currentEvent().filter(|event| {
                event.windowNumber() == window.windowNumber()
                    && matches!(event.r#type(), NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged)
            });
            let event = event.or_else(|| {
                NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                    NSEventType::LeftMouseDragged,
                    window.convertPointFromScreen(NSEvent::mouseLocation()),
                    NSEvent::modifierFlags_class(),
                    0.0,
                    window.windowNumber(),
                    None,
                    0,
                    1,
                    1.0,
                )
            }).ok_or("No native mouse event for vibemon drag")?;
            window.performWindowDragWithEvent(&event);
        }
        _ => return Err("Unsupported native vibemon action".into()),
    }
    Ok(())
}

#[cfg(test)]
#[path = "../__tests__/macos.rs"]
mod tests;

/// AppKit may not deliver mouseUp to the WebView after a native window drag.
pub(super) fn wait_for_drag_end() {
    while objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0 {
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
}
