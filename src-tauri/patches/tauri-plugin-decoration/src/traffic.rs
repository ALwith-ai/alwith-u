use crate::{
    frontend,
    lifecycle::{DecorationState, FrontendTarget, Generation},
    traffic_state::{
        restore_button_rect, restore_titlebar_rect, Activation, MacosTitlebarState, NativeGeometry,
        NativeObservation, NativeRect, NativeWindowKey, TrafficRegistry, TrafficSnapshot,
    },
};
use anyhow::anyhow;
use objc2::{exception, MainThreadMarker};
#[cfg(feature = "macos-transparency")]
use objc2_app_kit::NSColor;
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::NSRect;
use std::{ffi::c_void, panic::AssertUnwindSafe};
use tauri::{Error, Manager, Runtime, WebviewWindow, WindowEvent};

const MACOS_TITLEBAR_EVENT: &str = "macos-titlebar-state";

fn with_registry<R: Runtime, T>(
    window: &WebviewWindow<R>,
    action: impl FnOnce(&mut TrafficRegistry) -> T,
) -> Result<T, Error> {
    let state = window.try_state::<DecorationState>().ok_or_else(|| {
        Error::from(anyhow!(
            "tauri-plugin-decoration state is unavailable for macOS traffic lights"
        ))
    })?;
    Ok(state.with_traffic(action))
}

fn require_main_thread() -> Result<MainThreadMarker, Error> {
    MainThreadMarker::new().ok_or_else(|| {
        Error::from(anyhow!(
            "macOS native decoration operation must run on the application main thread"
        ))
    })
}

fn native_window_pointer<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(MainThreadMarker, *mut c_void), Error> {
    let main_thread = require_main_thread()?;
    let pointer = window.ns_window()?;
    if pointer.is_null() {
        Err(anyhow!("AppKit returned a null NSWindow pointer").into())
    } else {
        Ok((main_thread, pointer))
    }
}

fn native_window_key<R: Runtime>(window: &WebviewWindow<R>) -> Result<NativeWindowKey, Error> {
    let (_, native_window) = native_window_pointer(window)?;
    Ok(NativeWindowKey::new(native_window as usize))
}

fn describe_exception(exception: Option<objc2::rc::Retained<exception::Exception>>) -> String {
    match exception {
        Some(exception) => format!("{exception:?}"),
        None => "nil Objective-C exception".to_owned(),
    }
}

fn appkit<T>(context: &str, action: impl FnOnce() -> T) -> Result<T, Error> {
    exception::catch(AssertUnwindSafe(action)).map_err(|exception| {
        anyhow!(
            "{context} raised an Objective-C exception: {}",
            describe_exception(exception)
        )
        .into()
    })
}

fn run_native_mutation_transaction(
    apply_native: impl FnOnce() -> Result<(), String>,
    rollback_native: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut failure = match apply_native() {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };
    if let Err(error) = rollback_native() {
        failure.push_str("; native geometry rollback failed: ");
        failure.push_str(&error);
    }
    Err(failure)
}

fn positive_finite(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn translated_button_x(inset_x: f64, native_anchor_x: f64, native_button_x: f64) -> Option<f64> {
    let translated = inset_x + (native_button_x - native_anchor_x);
    (inset_x.is_finite()
        && native_anchor_x.is_finite()
        && native_button_x.is_finite()
        && translated.is_finite())
    .then_some(translated)
}

fn capture_rect(rect: NSRect) -> NativeRect {
    NativeRect {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
    }
}

fn apply_native_rect(mut rect: NSRect, native: NativeRect) -> NSRect {
    rect.origin.x = native.x;
    rect.origin.y = native.y;
    rect.size.width = native.width;
    rect.size.height = native.height;
    rect
}

fn native_geometry_needs_update(
    current_titlebar: NativeRect,
    desired_titlebar: NativeRect,
    current_buttons: [Option<NativeRect>; 3],
    desired_buttons: [Option<NativeRect>; 3],
) -> bool {
    current_titlebar != desired_titlebar || current_buttons != desired_buttons
}

fn should_refresh_traffic_lights(event: &WindowEvent) -> bool {
    matches!(
        event,
        WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. }
            | WindowEvent::Focused(true)
    )
}

/// Positions the AppKit traffic-light cluster and returns its right edge in
/// window-content coordinates.
fn position_traffic_lights(
    ns_window: &NSWindow,
    snapshot: TrafficSnapshot,
) -> Result<(f64, Option<NativeGeometry>), Error> {
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return Err(anyhow!("the AppKit close button is unavailable").into());
    };
    if close.isHidden() {
        return Err(anyhow!("the AppKit traffic-light cluster is hidden").into());
    }
    let buttons = [
        Some(close),
        ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton),
        ns_window.standardWindowButton(NSWindowButton::ZoomButton),
    ];

    // SAFETY: AppKit owns this view hierarchy. The operation runs on Tauri's
    // recorded event-loop thread while `ns_window` and its standard buttons
    // are alive, and the returned retained views remain local to this call.
    let Some(button_container) = (unsafe {
        buttons[0]
            .as_ref()
            .expect("close button is present")
            .superview()
    }) else {
        return Err(anyhow!("the AppKit traffic-light container is unavailable").into());
    };
    // SAFETY: Same ownership and main-thread argument as above.
    let Some(titlebar_container) = (unsafe { button_container.superview() }) else {
        return Err(anyhow!("the AppKit titlebar container is unavailable").into());
    };
    if titlebar_container.isHidden() {
        return Err(anyhow!("the AppKit titlebar container is hidden").into());
    }

    let close_frame = buttons[0]
        .as_ref()
        .expect("close button is present")
        .frame();
    let native_anchor_x = close_frame.origin.x;
    let button_height = close_frame.size.height;
    if !positive_finite(button_height) || !native_anchor_x.is_finite() {
        return Err(anyhow!("the AppKit close-button geometry is invalid").into());
    }

    let titlebar_height = button_height + snapshot.inset_y;
    let window_height = ns_window.frame().size.height;
    if !positive_finite(titlebar_height) || !window_height.is_finite() {
        return Err(anyhow!("the AppKit titlebar geometry is invalid").into());
    }

    let original_titlebar_frame = titlebar_container.frame();
    let titlebar_top_margin =
        window_height - original_titlebar_frame.origin.y - original_titlebar_frame.size.height;
    if !titlebar_top_margin.is_finite() {
        return Err(anyhow!("the AppKit titlebar margin is invalid").into());
    }
    let mut titlebar_frame = original_titlebar_frame;
    titlebar_frame.size.height = titlebar_height;
    titlebar_frame.origin.y = window_height - titlebar_height;

    let mut original_buttons = [None; 3];
    let mut desired_buttons = [None; 3];
    let mut desired_button_rects = [None; 3];
    let mut right_edge = 0.0_f64;
    for (role, button) in buttons.iter().enumerate() {
        let Some(button) = button else {
            continue;
        };
        let mut frame = button.frame();
        if !positive_finite(frame.size.width) {
            return Err(anyhow!("an AppKit traffic-light button has invalid geometry").into());
        }
        original_buttons[role] = Some(capture_rect(frame));
        let Some(translated_x) =
            translated_button_x(snapshot.inset_x, native_anchor_x, frame.origin.x)
        else {
            return Err(anyhow!("an AppKit traffic-light position is invalid").into());
        };
        frame.origin.x = translated_x;
        frame.origin.y = (titlebar_height - button_height) / 2.0;
        desired_buttons[role] = Some(frame);
        desired_button_rects[role] = Some(capture_rect(frame));
        right_edge = right_edge.max(frame.origin.x + frame.size.width);
    }
    if !positive_finite(right_edge) {
        return Err(anyhow!("the AppKit traffic-light width is invalid").into());
    }

    let geometry = NativeGeometry {
        titlebar: capture_rect(original_titlebar_frame),
        titlebar_top_margin,
        buttons: original_buttons,
    };
    if !native_geometry_needs_update(
        geometry.titlebar,
        capture_rect(titlebar_frame),
        geometry.buttons,
        desired_button_rects,
    ) {
        return Ok((right_edge, None));
    }
    run_native_mutation_transaction(
        || {
            appkit("positioning macOS traffic lights", || {
                titlebar_container.setFrame(titlebar_frame);
                for (role, button) in buttons.iter().enumerate() {
                    if let (Some(button), Some(frame)) = (button, desired_buttons[role]) {
                        button.setFrameOrigin(frame.origin);
                    }
                }
            })
            .map_err(|error| error.to_string())
        },
        || restore_traffic_geometry(ns_window, geometry).map_err(|error| error.to_string()),
    )
    .map_err(|error| Error::from(anyhow!(error)))?;
    Ok((right_edge, Some(geometry)))
}

fn observe_native(
    ns_window: &NSWindow,
    snapshot: TrafficSnapshot,
) -> Result<(NativeObservation, Option<NativeGeometry>), Error> {
    if ns_window
        .styleMask()
        .contains(NSWindowStyleMask::FullScreen)
    {
        Ok((NativeObservation::Fullscreen, None))
    } else {
        let (measured_cluster_right_edge, geometry) = position_traffic_lights(ns_window, snapshot)?;
        Ok((
            NativeObservation::Normal {
                measured_cluster_right_edge,
            },
            geometry,
        ))
    }
}

fn refresh<R: Runtime>(
    window: &WebviewWindow<R>,
    key: NativeWindowKey,
    generation: Generation,
) -> Result<(), Error> {
    let Some(snapshot) = with_registry(window, |registry| {
        registry.snapshot_for_listener(key, generation)
    })?
    else {
        return Ok(());
    };
    let (_main_thread, pointer) = native_window_pointer(window)?;
    if pointer as usize != key.native_window {
        return Err(anyhow!(
            "the native macOS window instance changed while traffic-light state was active"
        )
        .into());
    }

    // SAFETY: Tauri documents `ns_window` as the WKWebView's NSWindow handle.
    // The caller is on Tauri's event-loop thread, and the reference is not
    // retained or stored beyond this synchronous AppKit operation.
    let ns_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| Error::from(anyhow!("AppKit returned a null NSWindow pointer")))?;
    let (observation, previous_geometry) = appkit("refreshing macOS traffic lights", || {
        observe_native(ns_window, snapshot)
    })??;

    let dispatch = with_registry(window, |registry| {
        if let Some(previous_geometry) = previous_geometry {
            registry.record_original_geometry(key, generation, previous_geometry);
        }
        registry.record_observation(key, generation, observation)
    })?;
    if let Some((target, titlebar)) = dispatch {
        let script = frontend::dispatch_script(target, MACOS_TITLEBAR_EVENT, &titlebar)?;
        if let Err(eval_error) = window.eval(script) {
            let geometry_rollback = previous_geometry
                .map(|geometry| restore_traffic_geometry(ns_window, geometry))
                .transpose();
            let dispatch_rollback = with_registry(window, |registry| {
                registry.rollback_dispatch(key, generation, target, titlebar)
            });

            return match (geometry_rollback, dispatch_rollback) {
                (Ok(_), Ok(true)) => Err(eval_error),
                (geometry, dispatch) => {
                    let mut error =
                        format!("dispatching macOS traffic-light clearance failed: {eval_error}");
                    if let Err(rollback_error) = geometry {
                        error.push_str("; native geometry rollback failed: ");
                        error.push_str(&rollback_error.to_string());
                    }
                    match dispatch {
                        Ok(false) => {
                            error.push_str("; traffic-light dispatch state changed before rollback")
                        }
                        Err(rollback_error) => {
                            error.push_str("; traffic-light dispatch rollback failed: ");
                            error.push_str(&rollback_error.to_string());
                        }
                        Ok(true) => {}
                    }
                    Err(anyhow!(error).into())
                }
            };
        }
    }
    Ok(())
}

fn ensure_listener<R: Runtime>(
    window: &WebviewWindow<R>,
    key: NativeWindowKey,
    action: Activation,
) -> Result<(), Error> {
    if !action.installs_listener() {
        return Ok(());
    }

    let generation = action.generation();
    let observed = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            if let Err(error) = with_registry(&observed, |registry| {
                registry.destroy(key, generation);
            }) {
                eprintln!(
                    "decoration: failed to destroy macOS traffic-light state for {:?}: {error}",
                    observed.label()
                );
            }
        }
        event if should_refresh_traffic_lights(event) => {
            if let Err(error) = refresh(&observed, key, generation) {
                eprintln!(
                    "decoration: failed to refresh macOS traffic lights for {:?}: {error}",
                    observed.label()
                );
            }
        }
        _ => {}
    });

    if !with_registry(window, |registry| {
        registry.mark_listener_installed(key, generation)
    })? {
        return Err(anyhow!(
            "macOS traffic-light state changed while its event listener was being registered"
        )
        .into());
    }
    Ok(())
}

pub(crate) fn activate<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
) -> Result<(), Error> {
    let key = native_window_key(window)?;
    let action = with_registry(window, |registry| registry.activate(key, target))?;
    ensure_listener(window, key, action)?;
    refresh(window, key, action.generation())
}

fn restore_traffic_geometry(ns_window: &NSWindow, geometry: NativeGeometry) -> Result<(), Error> {
    let restored = appkit("restoring macOS traffic-light geometry", || {
        let close = ns_window
            .standardWindowButton(NSWindowButton::CloseButton)
            .ok_or_else(|| {
                "the close button is unavailable during geometry restoration".to_owned()
            })?;
        let buttons = [
            Some(close),
            ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton),
            ns_window.standardWindowButton(NSWindowButton::ZoomButton),
        ];

        // SAFETY: The close button and its AppKit-owned view hierarchy are
        // borrowed only for this synchronous main-thread restoration.
        let button_container = unsafe {
            buttons[0]
                .as_ref()
                .expect("close button is present")
                .superview()
        }
        .ok_or_else(|| {
            "the traffic-light container is unavailable during restoration".to_owned()
        })?;
        // SAFETY: Same ownership, lifetime, and main-thread argument.
        let titlebar_container = unsafe { button_container.superview() }
            .ok_or_else(|| "the titlebar container is unavailable during restoration".to_owned())?;

        let current_titlebar_frame = titlebar_container.frame();
        let titlebar_frame = apply_native_rect(
            current_titlebar_frame,
            restore_titlebar_rect(
                capture_rect(current_titlebar_frame),
                geometry.titlebar,
                ns_window.frame().size.height,
                geometry.titlebar_top_margin,
            ),
        );
        let mut button_frames = [None; 3];
        for (role, original) in geometry.buttons.iter().copied().enumerate() {
            let Some(original) = original else {
                continue;
            };
            let button = buttons[role].as_ref().ok_or_else(|| {
                format!("traffic-light button {role} disappeared before restoration")
            })?;
            let current = button.frame();
            button_frames[role] = Some(apply_native_rect(
                current,
                restore_button_rect(capture_rect(current), original),
            ));
        }

        titlebar_container.setFrame(titlebar_frame);
        for (role, frame) in button_frames.iter().copied().enumerate() {
            if let (Some(button), Some(frame)) = (buttons[role].as_ref(), frame) {
                button.setFrame(frame);
            }
        }
        Ok::<_, String>(())
    })?;
    restored.map_err(|error| Error::from(anyhow!(error)))
}

pub(crate) fn deactivate<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    let key = native_window_key(window)?;
    let Some(deactivation) = with_registry(window, |registry| registry.begin_deactivation(key))?
    else {
        return Ok(());
    };

    let mut failures = Vec::new();
    if let Some(geometry) = deactivation.original_geometry {
        let geometry_restoration =
            native_window_pointer(window).and_then(|(_main_thread, pointer)| {
                // SAFETY: Same documented pointer, lifetime, and main-thread
                // guarantees as in `refresh`.
                let ns_window =
                    unsafe { pointer.cast::<NSWindow>().as_ref() }.ok_or_else(|| {
                        Error::from(anyhow!("AppKit returned a null NSWindow pointer"))
                    })?;
                restore_traffic_geometry(ns_window, geometry)
            });
        match geometry_restoration {
            Ok(()) => {}
            Err(error) => failures.push(format!("native geometry restoration failed: {error}")),
        }
    }

    if let Some(target) = deactivation.target {
        let titlebar = MacosTitlebarState {
            fullscreen: false,
            clearance: 0.0,
        };
        match frontend::dispatch_script(target, MACOS_TITLEBAR_EVENT, &titlebar) {
            Ok(script) => {
                if let Err(error) = window.eval(script) {
                    failures.push(format!("frontend clearance cleanup failed: {error}"));
                }
            }
            Err(error) => failures.push(format!(
                "serializing frontend clearance cleanup failed: {error}"
            )),
        }
    }

    if failures.is_empty()
        && !with_registry(window, |registry| {
            registry.commit_deactivation(key, deactivation.generation)
        })?
    {
        failures.push("macOS traffic-light state changed before deactivation committed".to_owned());
    }
    if !failures.is_empty() {
        return Err(anyhow!(failures.join("; ")).into());
    }
    Ok(())
}

pub(crate) fn set_inset<R: Runtime>(
    window: &WebviewWindow<R>,
    inset_x: f64,
    inset_y: f64,
) -> Result<(), Error> {
    let key = native_window_key(window)?;
    let action = with_registry(window, |registry| registry.set_inset(key, inset_x, inset_y))?
        .map_err(|error| Error::from(anyhow!(error)))?;
    if let Some(action) = action {
        ensure_listener(window, key, action)?;
        refresh(window, key, action.generation())?;
    }
    Ok(())
}

#[cfg(feature = "macos-transparency")]
fn restore_transparency(
    ns_window: &NSWindow,
    previous_opaque: bool,
    previous_background: &NSColor,
) -> Result<(), Error> {
    appkit("restoring the macOS window transparency state", || {
        ns_window.setOpaque(previous_opaque);
        ns_window.setBackgroundColor(Some(previous_background));
    })
}

#[cfg(feature = "macos-transparency")]
pub(crate) fn make_transparent<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    let (_main_thread, pointer) = native_window_pointer(window)?;
    // SAFETY: Same documented pointer, lifetime, and main-thread guarantees
    // as in `refresh`.
    let ns_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| Error::from(anyhow!("AppKit returned a null NSWindow pointer")))?;
    let (previous_opaque, previous_background) =
        appkit("reading the macOS window transparency state", || {
            (ns_window.isOpaque(), ns_window.backgroundColor())
        })?;

    if let Err(error) = appkit("making the macOS window transparent", || {
        let clear = NSColor::clearColor();
        ns_window.setOpaque(false);
        ns_window.setBackgroundColor(Some(&clear));
    }) {
        let rollback = restore_transparency(ns_window, previous_opaque, &previous_background);
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => {
                Err(anyhow!("{error}; NSWindow rollback failed: {rollback_error}").into())
            }
        };
    }

    let webview: &tauri::Webview<R> = window.as_ref();
    let webview_result = appkit("making the macOS webview transparent", || {
        webview.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
    });
    let webview_error = match webview_result {
        Ok(Ok(())) => return Ok(()),
        Ok(Err(error)) => error.to_string(),
        Err(error) => error.to_string(),
    };
    let transparency_restoration =
        restore_transparency(ns_window, previous_opaque, &previous_background);
    match transparency_restoration {
        Ok(()) => Err(anyhow!(webview_error).into()),
        Err(rollback_error) => {
            Err(anyhow!("{webview_error}; NSWindow rollback failed: {rollback_error}").into())
        }
    }
}

pub(crate) fn set_window_level<R: Runtime>(
    window: &WebviewWindow<R>,
    level: i32,
) -> Result<(), Error> {
    let level = level as isize;
    let (_main_thread, pointer) = native_window_pointer(window)?;
    // SAFETY: Same documented pointer, lifetime, and event-loop-thread
    // guarantees as in `refresh`.
    let ns_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| Error::from(anyhow!("AppKit returned a null NSWindow pointer")))?;
    appkit("setting the macOS window level", || {
        ns_window.setLevel(level)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        native_geometry_needs_update, run_native_mutation_transaction,
        should_refresh_traffic_lights, translated_button_x,
    };
    use crate::traffic_state::NativeRect;
    use std::cell::Cell;
    use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};

    #[test]
    fn traffic_light_positions_preserve_appkits_measured_relative_spacing() {
        let native_close_x = 13.0;

        assert_eq!(translated_button_x(16.0, native_close_x, 13.0), Some(16.0));
        assert_eq!(translated_button_x(16.0, native_close_x, 33.5), Some(36.5));
        assert_eq!(
            translated_button_x(16.0, native_close_x, 55.25),
            Some(58.25)
        );
        assert_eq!(translated_button_x(16.0, native_close_x, f64::NAN), None);
    }

    #[test]
    fn unchanged_traffic_light_geometry_skips_native_mutation() {
        let titlebar = NativeRect {
            x: 0.0,
            y: 480.0,
            width: 800.0,
            height: 20.0,
        };
        let buttons = [
            Some(NativeRect {
                x: 16.0,
                y: 4.0,
                width: 12.0,
                height: 12.0,
            }),
            None,
            None,
        ];

        assert!(!native_geometry_needs_update(
            titlebar, titlebar, buttons, buttons,
        ));
        let mut moved = buttons;
        moved[0].as_mut().unwrap().x += 1.0;
        assert!(native_geometry_needs_update(
            titlebar, titlebar, buttons, moved,
        ));
    }

    #[test]
    fn window_movement_alone_does_not_rewrite_titlebar_geometry() {
        assert!(should_refresh_traffic_lights(&WindowEvent::Resized(
            PhysicalSize::new(800, 500),
        )));
        assert!(should_refresh_traffic_lights(&WindowEvent::Focused(true)));
        assert!(!should_refresh_traffic_lights(&WindowEvent::Moved(
            PhysicalPosition::new(20, 30),
        )));
        assert!(!should_refresh_traffic_lights(&WindowEvent::Focused(false)));
    }

    #[test]
    fn partial_traffic_light_mutation_is_rolled_back_before_failure_returns() {
        let mutated = Cell::new(false);

        let error = run_native_mutation_transaction(
            || {
                mutated.set(true);
                Err("second AppKit setter failed".to_owned())
            },
            || {
                mutated.set(false);
                Ok(())
            },
        )
        .unwrap_err();

        assert_eq!(error, "second AppKit setter failed");
        assert!(!mutated.get());
    }
}
