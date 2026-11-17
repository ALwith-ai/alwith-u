//! Preserve native effect observers across a window's Objective-C class change.
use objc2::{rc::Retained, runtime::AnyClass, MainThreadMarker};
use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::NSObjectProtocol;

/// Detach only native materials, leaving the runtime's webview host attached.
/// AppKit registers KVO against the window's current class when these views attach.
/// Changing that class while they remain attached invalidates their registrations.
#[doc(hidden)]
pub struct DetachedWindowEffects {
    parents: Vec<EffectParent>,
}

struct EffectParent {
    parent: Retained<NSView>,
    siblings: Vec<Retained<NSView>>,
    detached: Vec<bool>,
}

impl DetachedWindowEffects {
    pub fn new(window: &NSWindow) -> Self {
        MainThreadMarker::new().expect("Window effects require the main thread");
        let content = window.contentView().expect("A panel must have a content view");
        let classes = [AnyClass::get(c"NSGlassEffectView"), AnyClass::get(c"NSVisualEffectView")];
        let mut parents = Vec::new();
        Self::collect(content, &classes, &mut parents);
        for parent in &parents {
            for (view, detach) in parent.siblings.iter().zip(&parent.detached) {
                if *detach {
                    view.removeFromSuperview();
                }
            }
        }
        Self { parents }
    }

    fn collect(parent: Retained<NSView>, classes: &[Option<&AnyClass>], parents: &mut Vec<EffectParent>) {
        let siblings = parent.subviews().to_vec();
        let detached = siblings
            .iter()
            .map(|view| classes.iter().flatten().any(|class| view.isKindOfClass(class)))
            .collect::<Vec<_>>();
        for (view, detach) in siblings.iter().zip(&detached) {
            if !*detach {
                Self::collect(view.clone(), classes, parents);
            }
        }
        if detached.iter().any(|detach| *detach) {
            parents.push(EffectParent { parent, siblings, detached });
        }
    }
}

impl Drop for DetachedWindowEffects {
    fn drop(&mut self) {
        // Reinsert from front to back so the next original sibling is already attached.
        for parent in &self.parents {
            for index in (0..parent.siblings.len()).rev() {
                if parent.detached[index] {
                    let next = parent.siblings.get(index + 1).map(|view| &**view);
                    let order = if next.is_some() { NSWindowOrderingMode::Below } else { NSWindowOrderingMode::Above };
                    parent.parent.addSubview_positioned_relativeTo(&parent.siblings[index], order, next);
                }
            }
        }
    }
}
