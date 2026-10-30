use super::backdrop;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSScreen, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{NSPoint, NSRect, NSSize};

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
    let screen = parent.screen().ok_or("Pet screen unavailable")?.visibleFrame();
    window.setFrame_display(bubble_frame(parent.frame(), size, screen), true);
    Ok(())
}

/// Relayout without changing the bubble's visibility, focus, or parent relationship.
pub(crate) fn repair_bubble_position(window: &NSWindow, parent: &NSWindow) -> Result<(), String> {
    layout_bubble(window, parent, window.frame().size)
}

pub(super) fn apply(host: &tauri::WebviewWindow, action: super::WindowAction) -> Result<(), String> {
    let marker = MainThreadMarker::new().ok_or("Vibemon native actions require the main thread")?;
    // SAFETY: the app supplies a retained live NSWindow and executes synchronously on its UI thread.
    let window = unsafe { &*(action.handle as *const NSWindow) };
    match action.action.as_str() {
        "blur" => backdrop::apply(window, action.radius.ok_or("Missing pet blur radius")?, action.path)?,
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
            backdrop::forget(action.handle);
        }
        "present" => {
            crate::panel::prepare(host)?;
            crate::panel::set_presented(host.label(), true);
            if action.role == "pet" {
                ensure_visible(window)?;
            }
            window.orderFrontRegardless();
            if action.role != "pet" {
                window.makeKeyWindow();
            }
        }
        "hide" => {
            crate::panel::set_presented(host.label(), false);
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
            let event = app.currentEvent().ok_or("No native mouse event for pet drag")?;
            window.performWindowDragWithEvent(&event);
        }
        _ => return Err("Unsupported native pet action".into()),
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
