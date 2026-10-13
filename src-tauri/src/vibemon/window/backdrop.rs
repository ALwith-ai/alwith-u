//! U bubble backdrop. AppKit access stays on its UI thread.
use std::cell::RefCell;
use std::collections::HashMap;
use std::ptr;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSView, NSVisualEffectBlendingMode, NSVisualEffectState, NSVisualEffectView, NSWindow,
    NSWindowOrderingMode,
};
use objc2_core_graphics::CGMutablePath;
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSSize, ns_string};
use objc2_quartz_core::{CALayer, CAShapeLayer, CATransaction};

use super::BackdropPathCommand;

struct BackdropLayers {
    backdrop: Retained<CALayer>,
    container: Retained<CALayer>,
    mask: Retained<CAShapeLayer>,
    outline: RefCell<Option<Vec<BackdropPathCommand>>>,
}

define_class!(
    #[unsafe(super = NSVisualEffectView)]
    #[name = "ALwithUPetBackdropView"]
    #[thread_kind = MainThreadOnly]
    #[ivars = BackdropLayers]
    struct PetBackdropView;

    impl PetBackdropView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            ptr::null_mut()
        }

        #[unsafe(method(updateLayer))]
        fn update_layer(&self) {
        }

        #[unsafe(method(_shouldAutoFlattenLayerTree))]
        fn should_auto_flatten_layer_tree(&self) -> bool {
            false
        }

        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            unsafe { let _: () = msg_send![super(self), setFrameSize: size]; }
            self.update_geometry();
        }
    }
);

impl PetBackdropView {
    fn new(mtm: MainThreadMarker, frame: NSRect, outline: Vec<BackdropPathCommand>) -> Retained<Self> {
        let backdrop_class = AnyClass::get(c"CABackdropLayer").expect("macOS CABackdropLayer is required");
        let filter_class = AnyClass::get(c"CAFilter").expect("macOS CAFilter is required");
        let backdrop: Retained<CALayer> = unsafe { msg_send![backdrop_class, layer] };
        let blur: Retained<AnyObject> = unsafe { msg_send![filter_class, filterWithType: ns_string!("gaussianBlur")] };
        unsafe {
            let _: () =
                msg_send![&*blur, setValue: &*NSNumber::new_bool(true), forKey: ns_string!("inputNormalizeEdges")];
            let _: () = msg_send![&*backdrop, setWindowServerAware: true];
            let _: () = msg_send![&*backdrop, setAllowsGroupBlending: true];
            let _: () = msg_send![&*backdrop, setAllowsGroupOpacity: true];
            let _: () = msg_send![&*backdrop, setAllowsEdgeAntialiasing: false];
            let _: () = msg_send![&*backdrop, setDisablesOccludedBackdropBlurs: true];
            let _: () = msg_send![&*backdrop, setIgnoresOffscreenGroups: true];
            let _: () = msg_send![&*backdrop, setAllowsInPlaceFiltering: false];
            let _: () = msg_send![&*backdrop, setAllowsSubstituteColor: true];
            let _: () = msg_send![&*backdrop, setBleedAmount: 0.0_f64];
            let _: () = msg_send![&*backdrop, setScale: 1.0_f64];
            let _: () = msg_send![&*backdrop, setFilters: &*NSArray::from_slice(&[&*blur])];
        }
        let container = CALayer::new();
        let mask = CAShapeLayer::new();
        container.setMasksToBounds(true);
        unsafe {
            container.setMask(Some(&mask));
            container.addSublayer(&backdrop);
        }
        let view = Self::alloc(mtm).set_ivars(BackdropLayers {
            backdrop,
            container,
            mask,
            outline: RefCell::new(Some(outline)),
        });
        let view: Retained<Self> = unsafe { msg_send![super(view), initWithFrame: frame] };
        view.setWantsLayer(true);
        view.setState(NSVisualEffectState::Active);
        view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        unsafe {
            let _: () = msg_send![&*view, setValue: &*NSNumber::new_bool(true), forKey: ns_string!("clear")];
            view.layer().expect("Chat backdrop must have a layer").addSublayer(&view.ivars().container);
        }
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        view.update_geometry();
        view
    }

    fn update(&self, radius: u32, outline: Option<Vec<BackdropPathCommand>>) {
        let hidden = outline.is_none();
        self.ivars().outline.replace(outline);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        unsafe {
            let _: () = msg_send![&*self.ivars().backdrop, setValue: &*NSNumber::new_f64(f64::from(radius)), forKeyPath: ns_string!("filters.gaussianBlur.inputRadius")];
        }
        self.setHidden(hidden);
        self.update_geometry();
        CATransaction::commit();
    }

    fn update_geometry(&self) {
        let layers = self.ivars();
        let outline = layers.outline.borrow();
        let Some(outline) = outline.as_ref() else {
            return;
        };
        let bounds = self.bounds();
        let path = CGMutablePath::new();
        append_path(&path, bounds.size.height, outline);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        layers.container.setFrame(bounds);
        layers.backdrop.setFrame(bounds);
        layers.mask.setFrame(bounds);
        layers.mask.setPath(Some(&path));
        CATransaction::commit();
    }
}
thread_local! {
 static BACKDROPS: RefCell<HashMap<usize, Retained<PetBackdropView>>> = RefCell::new(HashMap::new());
}
pub(super) fn apply(native: &NSWindow, radius: u32, outline: Option<Vec<BackdropPathCommand>>) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("Pet backdrop requires the main thread")?;
    let handle = native as *const _ as usize;
    BACKDROPS.with_borrow_mut(|backdrops| {
  if let Some(view) = backdrops.get(&handle) { view.update(radius, outline); return Ok(()) }
  let Some(outline) = outline else { return Ok(()) };
  let content = native.contentView().ok_or("Pet bubble requires its content view")?;
  let parent = unsafe { content.superview() }.ok_or("Pet bubble content must be attached")?;
  let view = PetBackdropView::new(mtm, content.frame(), outline);
  unsafe { let _: () = msg_send![&*view.ivars().backdrop, setValue: &*NSNumber::new_f64(f64::from(radius)), forKeyPath: ns_string!("filters.gaussianBlur.inputRadius")]; }
  parent.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, Some(&content));
  backdrops.insert(handle, view);
  Ok(())
 })
}
pub(super) fn forget(handle: usize) {
    BACKDROPS.with_borrow_mut(|backdrops| {
        if let Some(view) = backdrops.remove(&handle) {
            view.removeFromSuperview();
        }
    });
}

fn append_path(path: &CGMutablePath, height: f64, commands: &[BackdropPathCommand]) {
    unsafe {
        for command in commands {
            match *command {
                BackdropPathCommand::Move { x, y } => {
                    CGMutablePath::move_to_point(Some(path), ptr::null(), x, height - y)
                }
                BackdropPathCommand::Line { x, y } => {
                    CGMutablePath::add_line_to_point(Some(path), ptr::null(), x, height - y)
                }
                BackdropPathCommand::Curve { control1_x, control1_y, control2_x, control2_y, x, y } => {
                    CGMutablePath::add_curve_to_point(
                        Some(path),
                        ptr::null(),
                        control1_x,
                        height - control1_y,
                        control2_x,
                        height - control2_y,
                        x,
                        height - y,
                    )
                }
                BackdropPathCommand::Close => CGMutablePath::close_subpath(Some(path)),
            }
        }
    }
}
