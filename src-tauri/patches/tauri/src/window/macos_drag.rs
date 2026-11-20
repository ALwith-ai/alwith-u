// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{cell::RefCell, ptr::NonNull};

use block2::RcBlock;
use objc2::{MainThreadMarker, Message, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSWindow};

struct Gesture {
  window: isize,
  armed: bool,
  dragged: Option<Retained<NSEvent>>,
}

thread_local! {
  static GESTURE: RefCell<Option<Gesture>> = const { RefCell::new(None) };
  static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

pub(super) fn install() -> Result<(), &'static str> {
  if MONITOR.with_borrow(Option::is_some) {
    return Ok(());
  }
  let handler = RcBlock::new(|event: NonNull<NSEvent>| {
    // AppKit supplies the live event on the main thread.
    let native = unsafe { event.as_ref() };
    let start = GESTURE.with_borrow_mut(|pending| match native.r#type() {
      NSEventType::LeftMouseDown => {
        *pending = Some(Gesture { window: native.windowNumber(), armed: false, dragged: None });
        false
      }
      NSEventType::LeftMouseUp => {
        *pending = None;
        false
      }
      NSEventType::LeftMouseDragged => {
        let Some(gesture) = pending.as_mut() else {
          return false;
        };
        if gesture.window != native.windowNumber() {
          return false;
        }
        if gesture.armed {
          *pending = None;
          true
        } else {
          gesture.dragged = Some(native.retain());
          false
        }
      }
      _ => unreachable!("Only left mouse gestures are monitored"),
    });
    if start
      && let Some(window) =
        native.window(MainThreadMarker::new().expect("AppKit event monitor requires the main thread"))
    {
      window.performWindowDragWithEvent(native);
      return std::ptr::null_mut();
    }
    event.as_ptr()
  });

  let mask = NSEventMask::LeftMouseDown | NSEventMask::LeftMouseUp | NSEventMask::LeftMouseDragged;
  let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) }
    .ok_or("Could not monitor macOS window dragging")?;
  MONITOR.with_borrow_mut(|installed| *installed = Some(monitor));
  Ok(())
}

pub(super) fn arm(window: &NSWindow) {
  if NSEvent::pressedMouseButtons() & 1 == 0 {
    return;
  }
  let dragged = GESTURE.with_borrow_mut(|pending| {
    let gesture = pending.as_mut()?;
    if gesture.window != window.windowNumber() {
      return None;
    }
    gesture.armed = true;
    let dragged = gesture.dragged.take()?;
    *pending = None;
    Some(dragged)
  });
  // The first drag event may reach AppKit before the WebView's IPC. In either
  // order, hand AppKit an event from the actual drag on the destination window.
  if let Some(event) = dragged {
    window.performWindowDragWithEvent(&event);
  }
}
