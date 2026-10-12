use crate::{
    frontend::{self, SnapGeometry, SnapGeometryUpdate},
    lifecycle::FrontendTarget,
    snap_state::{Callbacks, EventBridge, Geometry, Registry, SnapEvent},
};
use anyhow::anyhow;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, Mutex, MutexGuard, OnceLock},
};
use tauri::{Runtime, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        HiDpi::GetDpiForWindow,
        Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, RegisterClassExW,
            SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW, HTMAXBUTTON, HWND_TOP,
            SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, WM_DPICHANGED, WM_NCDESTROY, WM_NCHITTEST,
            WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE, WM_SIZE,
            WNDCLASSEXW, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
        },
    },
};

const MAX_TITLEBAR_BAND_LOGICAL: u64 = 128;
const MAX_CONTROL_BAND_LOGICAL: u64 = 640;
const MAX_MAXIMIZE_WIDTH_LOGICAL: u64 = 256;
const MAX_MAXIMIZE_HEIGHT_LOGICAL: u64 = 128;

const SNAP_CLASS: &[u16] = &[
    b'T' as u16,
    b'a' as u16,
    b'u' as u16,
    b'r' as u16,
    b'i' as u16,
    b'P' as u16,
    b'l' as u16,
    b'u' as u16,
    b'g' as u16,
    b'i' as u16,
    b'n' as u16,
    b'D' as u16,
    b'e' as u16,
    b'c' as u16,
    b'o' as u16,
    b'r' as u16,
    b'a' as u16,
    b't' as u16,
    b'i' as u16,
    b'o' as u16,
    b'n' as u16,
    b'S' as u16,
    b'n' as u16,
    b'a' as u16,
    b'p' as u16,
    b'V' as u16,
    b'2' as u16,
    0,
];

const SUBCLASS_ID: usize = 1;
static SNAP_WINDOWS: OnceLock<Mutex<Registry>> = OnceLock::new();
static SNAP_CLASS_REGISTRATION: OnceLock<Result<isize, String>> = OnceLock::new();

fn snap_windows() -> &'static Mutex<Registry> {
    SNAP_WINDOWS.get_or_init(|| Mutex::new(Registry::default()))
}

fn lock_snap_windows() -> MutexGuard<'static, Registry> {
    snap_windows().lock().unwrap()
}

fn with_registry<T>(action: impl FnOnce(&mut Registry) -> T) -> T {
    let mut registry = lock_snap_windows();
    action(&mut registry)
}

pub(crate) fn install<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    geometry: SnapGeometry,
) -> Result<(), tauri::Error> {
    let hwnd = window_hwnd(window)?;
    let measured = Geometry::new(geometry.x, geometry.y, geometry.width, geometry.height);
    validate_geometry(
        hwnd as HWND,
        measured,
        geometry.titlebar_height,
        geometry.control_band_width,
    )?;

    let bridge = Arc::new(EventBridge::new());
    let consumer = bridge.clone();
    let event_window = window.clone();
    tauri::async_runtime::spawn(async move {
        let mut hovered = false;
        let mut pressed = false;
        loop {
            consumer.wait().await;
            if consumer.is_closed() {
                break;
            }
            let snapshot = consumer.take();
            let dispatch = |event: SnapEvent| {
                if let Ok(script) = frontend::dispatch_script(target, event.as_str(), &()) {
                    if let Err(error) = event_window.eval(script) {
                        eprintln!("decoration: failed to deliver Windows Snap event: {error}");
                    }
                }
            };
            if snapshot.hovered() != hovered {
                hovered = snapshot.hovered();
                dispatch(if hovered {
                    SnapEvent::MouseEnter
                } else {
                    SnapEvent::MouseLeave
                });
            }
            if snapshot.pressed() != pressed {
                pressed = snapshot.pressed();
                dispatch(if pressed {
                    SnapEvent::MouseDown
                } else {
                    SnapEvent::MouseUp
                });
            }
            for _ in 0..snapshot.clicks() {
                dispatch(SnapEvent::Click);
            }
        }
    });

    let event_bridge = bridge.clone();
    let event_callback = Arc::new(move |event: SnapEvent| {
        event_bridge.publish(event);
    });
    let close_bridge = bridge.clone();
    let callbacks = Callbacks::with_close(event_callback, Arc::new(move || close_bridge.close()));

    if let Err(error) = unsafe { install_hwnd(hwnd, measured, callbacks) } {
        bridge.close();
        return Err(error);
    }
    if let Err(error) = refresh_fullscreen(window) {
        let rollback = unsafe { uninstall_hwnd(hwnd) }.err();
        return match rollback {
            Some(rollback) => Err(anyhow!(
                "initial snap fullscreen synchronization failed: {error}; rollback failed: {rollback}"
            )
            .into()),
            None => Err(error),
        };
    }
    Ok(())
}

pub(crate) fn uninstall<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), tauri::Error> {
    let hwnd = window_hwnd(window)?;
    unsafe { uninstall_hwnd(hwnd) }
}

fn validate_geometry(
    hwnd: HWND,
    geometry: Geometry,
    titlebar_height: u32,
    control_band_width: u32,
) -> Result<(), tauri::Error> {
    if geometry.width == 0 || geometry.height == 0 || geometry.x < 0 || geometry.y < 0 {
        return Err(
            anyhow!("snap maximize-button geometry must be a non-empty client rectangle").into(),
        );
    }
    // SAFETY: `hwnd` is a live Tauri window and `rect` is a valid output buffer.
    let mut rect = unsafe { std::mem::zeroed() };
    if unsafe { GetClientRect(hwnd, &mut rect) } == 0 {
        return Err(last_os_error("GetClientRect"));
    }
    let right = i64::from(geometry.x) + i64::from(geometry.width);
    let bottom = i64::from(geometry.y) + i64::from(geometry.height);
    if right > i64::from(rect.right) || bottom > i64::from(rect.bottom) {
        return Err(
            anyhow!("snap maximize-button geometry lies outside the window client area").into(),
        );
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        return Err(last_os_error("GetDpiForWindow"));
    }
    if !trusted_caption_region(
        rect.right,
        dpi,
        geometry,
        titlebar_height,
        control_band_width,
    ) {
        return Err(anyhow!(
            "snap maximize-button geometry is outside the trusted top-right caption region"
        )
        .into());
    }
    Ok(())
}

fn trusted_caption_region(
    client_right: i32,
    dpi: u32,
    geometry: Geometry,
    titlebar_height: u32,
    control_band_width: u32,
) -> bool {
    let right = i64::from(geometry.x) + i64::from(geometry.width);
    let logical = |value: u64| value.saturating_mul(96).div_ceil(u64::from(dpi));
    let titlebar_height_logical = logical(u64::from(titlebar_height));
    let control_band_width_logical = logical(u64::from(control_band_width));
    if titlebar_height_logical == 0
        || titlebar_height_logical > MAX_TITLEBAR_BAND_LOGICAL
        || control_band_width_logical == 0
        || control_band_width_logical > MAX_CONTROL_BAND_LOGICAL
    {
        return false;
    }

    let width = u64::from(geometry.width);
    let height = u64::from(geometry.height);
    let width_logical = logical(width);
    let height_logical = logical(height);
    if width_logical == 0
        || width_logical > MAX_MAXIMIZE_WIDTH_LOGICAL
        || height_logical == 0
        || height_logical > MAX_MAXIMIZE_HEIGHT_LOGICAL
    {
        return false;
    }
    let top = u64::try_from(geometry.y).unwrap_or(u64::MAX);
    let distance_from_right = u64::try_from(i64::from(client_right) - right).unwrap_or(u64::MAX);
    distance_from_right.saturating_add(width) <= u64::from(control_band_width)
        && height <= u64::from(titlebar_height)
        && top.saturating_add(height) <= u64::from(titlebar_height)
}

pub(crate) fn apply_update<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    update: SnapGeometryUpdate,
) -> Result<(), tauri::Error> {
    match update {
        SnapGeometryUpdate::Geometry { geometry, .. } => {
            install_or_update(window, target, geometry)
        }
        SnapGeometryUpdate::Disabled { .. } => uninstall(window),
    }
}

pub(crate) fn install_or_update<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    geometry: SnapGeometry,
) -> Result<(), tauri::Error> {
    let hwnd = window_hwnd(window)?;
    if with_registry(|registry| registry.position(hwnd)).is_some() {
        update_geometry(window, geometry)
    } else {
        install(window, target, geometry)
    }
}

pub(crate) fn update_geometry<R: Runtime>(
    window: &WebviewWindow<R>,
    geometry: SnapGeometry,
) -> Result<(), tauri::Error> {
    let hwnd = window_hwnd(window)?;
    let measured = Geometry::new(geometry.x, geometry.y, geometry.width, geometry.height);
    validate_geometry(
        hwnd as HWND,
        measured,
        geometry.titlebar_height,
        geometry.control_band_width,
    )?;
    if with_registry(|registry| registry.update_geometry(hwnd, measured)).is_none() {
        return Err(anyhow!("no snap overlay is installed for this window").into());
    }
    // SAFETY: The registered parent and child HWNDs are live on the GUI thread.
    unsafe { update_overlay_position(hwnd as HWND) }
}

unsafe fn install_hwnd(
    hwnd: isize,
    geometry: Geometry,
    callbacks: Callbacks,
) -> Result<(), tauri::Error> {
    if with_registry(|registry| registry.position(hwnd)).is_some() {
        return Err(anyhow!("a snap overlay is already installed for this window").into());
    }
    let instance = register_class()?;
    let parent = hwnd as HWND;
    // SAFETY: `parent` is the live HWND supplied by Tauri, `instance` owns the
    // registered static class, and all optional pointer arguments are null.
    let overlay = unsafe {
        CreateWindowExW(
            0,
            SNAP_CLASS.as_ptr(),
            SNAP_CLASS.as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
            0,
            0,
            0,
            0,
            parent,
            std::ptr::null_mut(),
            instance,
            std::ptr::null_mut(),
        )
    };
    if overlay.is_null() {
        return Err(last_os_error("CreateWindowExW"));
    }

    // SAFETY: `parent` remains live, and `parent_subclass_proc` has the required
    // static Win32 callback ABI and does not unwind across the FFI boundary.
    let subclass_installed =
        unsafe { SetWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID, 0) != 0 };
    if !subclass_installed {
        let subclass_error = anyhow!("SetWindowSubclass failed for the decoration snap overlay");
        // SAFETY: `overlay` is the non-null child HWND created above and has
        // not yet been transferred to the registry.
        let destroy_result = unsafe { DestroyWindow(overlay) };
        return if destroy_result == 0 {
            Err(anyhow!("{subclass_error}; cleanup DestroyWindow failed").into())
        } else {
            Err(subclass_error.into())
        };
    }

    if let Err(error) =
        with_registry(|registry| registry.insert(hwnd, overlay as isize, geometry, callbacks))
    {
        // SAFETY: Both HWNDs are still live and owned by this installation
        // attempt; the callback and subclass ID match the successful install.
        let destroy_failed = unsafe {
            RemoveWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID);
            DestroyWindow(overlay) == 0
        };
        return if destroy_failed {
            Err(anyhow!("{error}; cleanup DestroyWindow failed").into())
        } else {
            Err(anyhow!(error).into())
        };
    }

    // SAFETY: The parent and newly registered overlay are both live for the
    // duration of this synchronous position update.
    let position_result = unsafe { update_overlay_position(parent) };
    if let Err(error) = position_result {
        // SAFETY: This rolls back the same live HWND registered above.
        let rollback = unsafe { uninstall_hwnd(hwnd) }.err();
        return match rollback {
            Some(rollback) => Err(anyhow!(
                "snap overlay positioning failed: {error}; rollback failed: {rollback}"
            )
            .into()),
            None => Err(error),
        };
    }

    Ok(())
}

unsafe fn uninstall_hwnd(hwnd: isize) -> Result<(), tauri::Error> {
    let parent = hwnd as HWND;
    let Some(position) = with_registry(|registry| registry.position(hwnd)) else {
        return Ok(());
    };
    if position.overlay_live() {
        unsafe { ShowWindow(position.overlay() as HWND, SW_HIDE) };

        // Keep the registry entry and parent subclass installed until
        // destruction succeeds. WM_NCDESTROY marks the overlay dead before it
        // attempts the parent-subclass removal, so either failure remains
        // represented and retryable.
        if unsafe { DestroyWindow(position.overlay() as HWND) } == 0 {
            return Err(anyhow!(
                "DestroyWindow failed for the snap overlay: {}",
                std::io::Error::last_os_error()
            )
            .into());
        }
    }

    // WM_NCDESTROY normally completes this synchronously. If it could not
    // remove the parent subclass, the dead overlay remains registered so this
    // path (and later calls) can retry the exact incomplete cleanup.
    if with_registry(|registry| registry.position(hwnd)).is_none() {
        return Ok(());
    }
    if unsafe { RemoveWindowSubclass(parent, Some(parent_subclass_proc), SUBCLASS_ID) } == 0 {
        return Err(anyhow!("RemoveWindowSubclass failed for the snap overlay").into());
    }
    if let Some(removed) = with_registry(|registry| registry.remove_parent(hwnd)) {
        removed.close();
    }
    Ok(())
}

fn register_class() -> Result<HINSTANCE, tauri::Error> {
    let registration = SNAP_CLASS_REGISTRATION.get_or_init(|| unsafe {
        let instance = GetModuleHandleW(std::ptr::null()) as HINSTANCE;
        if instance.is_null() {
            return Err(format!(
                "GetModuleHandleW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(overlay_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: SNAP_CLASS.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        if RegisterClassExW(&class) == 0 {
            return Err(format!(
                "RegisterClassExW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(instance as isize)
    });

    registration
        .as_ref()
        .copied()
        .map(|instance| instance as HINSTANCE)
        .map_err(|error| anyhow!(error.clone()).into())
}

unsafe fn update_overlay_position(hwnd: HWND) -> Result<(), tauri::Error> {
    let Some(position) = with_registry(|registry| registry.position(hwnd as isize)) else {
        return Ok(());
    };
    if position.fullscreen() || position.awaiting_geometry() {
        // SAFETY: The caller guarantees that the parent and its registered
        // child overlay remain live for this synchronous update.
        unsafe { ShowWindow(position.overlay() as HWND, SW_HIDE) };
        return Ok(());
    }

    let width = i32::try_from(position.width())
        .map_err(|_| anyhow!("snap maximize-button width exceeds Win32 bounds"))?;
    let height = i32::try_from(position.height())
        .map_err(|_| anyhow!("snap maximize-button height exceeds Win32 bounds"))?;
    // SAFETY: The caller guarantees that the registered child overlay remains
    // live, and the calculated dimensions are bounded signed integers.
    if unsafe {
        SetWindowPos(
            position.overlay() as HWND,
            HWND_TOP,
            position.x(),
            position.y(),
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    } == 0
    {
        return Err(last_os_error("SetWindowPos"));
    }
    Ok(())
}

pub(crate) fn refresh_fullscreen<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    let fullscreen = window.is_fullscreen()?;
    let hwnd = window_hwnd(window)?;
    let Some((position, effects)) =
        with_registry(|registry| registry.set_fullscreen(hwnd, fullscreen))
    else {
        return Ok(());
    };

    let native_update = unsafe {
        // Fullscreen transitions invalidate the measured titlebar rectangle.
        // Keep the native hit target hidden until the frontend commits a fresh
        // post-transition geometry update.
        ShowWindow(position.overlay() as HWND, SW_HIDE);
        Ok(())
    };
    if let Err(error) = native_update {
        with_registry(|registry| registry.rollback_fullscreen(hwnd, fullscreen));
        return Err(error);
    }
    effects.dispatch();
    Ok(())
}

fn registered_overlay(hwnd: HWND) -> bool {
    with_registry(|registry| registry.parent_for_overlay(hwnd as isize).is_some())
}

fn last_os_error(operation: &str) -> tauri::Error {
    anyhow!("{operation} failed: {}", std::io::Error::last_os_error()).into()
}

unsafe fn handle_parent_message(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_SIZE | WM_DPICHANGED => {
            if let Some(position) =
                with_registry(|registry| registry.await_fresh_geometry(hwnd as isize))
            {
                // The DOM ResizeObserver supplies a fresh measured rectangle.
                // Hide the stale native hit target until that update arrives.
                unsafe { ShowWindow(position.overlay() as HWND, SW_HIDE) };
            }
        }
        WM_NCDESTROY => {
            // Parent destruction already destroyed the child overlay. Remove
            // only Rust bookkeeping and this callback; never call DestroyWindow
            // from the parent's terminal destruction message.
            if let Some(removed) = with_registry(|registry| registry.remove_parent(hwnd as isize)) {
                removed.close();
            }
            // SAFETY: The callback is currently installed on this HWND with
            // the same function pointer and subclass ID.
            unsafe { RemoveWindowSubclass(hwnd, Some(parent_subclass_proc), SUBCLASS_ID) };
        }
        _ => {}
    }
    // SAFETY: These are the unchanged parameters supplied by Win32 to the
    // active subclass callback.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

unsafe extern "system" fn parent_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: Win32 supplied these parameters to this registered callback.
        unsafe { handle_parent_message(hwnd, msg, wparam, lparam) }
    }))
    .unwrap_or_else(|_| {
        // SAFETY: On panic, forwarding the original callback parameters keeps
        // unwinding inside Rust and preserves the Win32 subclass chain.
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    })
}

unsafe fn handle_overlay_message(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST if registered_overlay(hwnd) => return HTMAXBUTTON as LRESULT,
        WM_NCMOUSEMOVE => {
            let effects = with_registry(|registry| registry.mouse_move(hwnd as isize));
            let entered = effects.entered();
            effects.dispatch();
            if entered {
                let mut track = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                // SAFETY: `track` is fully initialized for the live overlay.
                if unsafe { TrackMouseEvent(&mut track) } == 0 {
                    let effects = with_registry(|registry| registry.mouse_leave(hwnd as isize));
                    effects.dispatch();
                }
            }
            return 0;
        }
        WM_NCMOUSELEAVE => {
            let effects = with_registry(|registry| registry.mouse_leave(hwnd as isize));
            effects.dispatch();
            return 0;
        }
        WM_NCLBUTTONDOWN => {
            let effects = with_registry(|registry| registry.mouse_down(hwnd as isize));
            effects.dispatch();
            return 0;
        }
        WM_NCLBUTTONUP => {
            let effects = with_registry(|registry| registry.mouse_up(hwnd as isize));
            effects.dispatch();
            return 0;
        }
        WM_NCDESTROY => {
            let parent = with_registry(|registry| registry.mark_overlay_destroyed(hwnd as isize));
            if let Some(parent) = parent {
                // Remove the registry entry only after the matching parent
                // subclass is gone. A failure leaves a dead-overlay record for
                // uninstall_hwnd to retry without destroying the HWND again.
                if unsafe {
                    RemoveWindowSubclass(parent as HWND, Some(parent_subclass_proc), SUBCLASS_ID)
                } != 0
                {
                    if let Some(removed) = with_registry(|registry| registry.remove_parent(parent))
                    {
                        removed.close();
                    }
                }
            }
        }
        _ => {}
    }
    // SAFETY: Forward the original parameters supplied by Win32.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

unsafe extern "system" fn overlay_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: Win32 supplied these parameters to this registered callback.
        unsafe { handle_overlay_message(hwnd, msg, wparam, lparam) }
    }))
    .unwrap_or_else(|_| {
        // SAFETY: On panic, forward the original Win32 callback parameters.
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    })
}

fn window_hwnd<R: Runtime>(window: &WebviewWindow<R>) -> Result<isize, tauri::Error> {
    let handle = window.window_handle()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get()),
        _ => Err(anyhow!("native snap overlay requires a Win32 window handle").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{trusted_caption_region, Geometry};

    #[test]
    fn trusted_snap_geometry_uses_measured_titlebar_and_control_bounds() {
        assert!(trusted_caption_region(
            1200,
            96,
            Geometry::new(942, 64, 200, 64),
            128,
            400,
        ));

        for geometry in [
            Geometry::new(400, 0, 58, 32),
            Geometry::new(1084, 100, 58, 32),
            Geometry::new(1084, 64, 58, 65),
            Geometry::new(1084, 0, 401, 32),
        ] {
            assert!(!trusted_caption_region(1200, 96, geometry, 128, 400));
        }
    }

    #[test]
    fn trusted_snap_geometry_contains_the_whole_rectangle_in_the_right_band() {
        assert!(!trusted_caption_region(
            1920,
            96,
            Geometry::new(0, 0, 896, 32),
            32,
            1024,
        ));
        assert!(!trusted_caption_region(
            1920,
            96,
            Geometry::new(896, 0, 896, 32),
            32,
            1024,
        ));
        assert!(trusted_caption_region(
            1920,
            96,
            Geometry::new(1664, 0, 128, 32),
            32,
            256,
        ));
    }

    #[test]
    fn trusted_snap_geometry_preserves_shared_edges_at_fractional_dpi() {
        assert!(trusted_caption_region(
            50,
            144,
            Geometry::new(40, 1, 10, 2),
            3,
            10,
        ));
    }

    #[test]
    fn trusted_snap_geometry_accepts_three_hundred_percent_dpi_measurements() {
        assert!(trusted_caption_region(
            3600,
            288,
            Geometry::new(3252, 0, 174, 96),
            96,
            522,
        ));
    }

    #[test]
    fn trusted_snap_geometry_accepts_three_hundred_percent_browser_zoom_at_system_scale() {
        assert!(trusted_caption_region(
            3600,
            96,
            Geometry::new(3078, 0, 174, 96),
            96,
            522,
        ));
    }

    #[test]
    fn trusted_snap_geometry_has_independent_conservative_failsafes() {
        assert!(!trusted_caption_region(
            2000,
            96,
            Geometry::new(1000, 0, 100, 32),
            129,
            512,
        ));
        assert!(!trusted_caption_region(
            2000,
            96,
            Geometry::new(1000, 0, 100, 32),
            128,
            641,
        ));
        assert!(!trusted_caption_region(
            2000,
            96,
            Geometry::new(1700, 0, 257, 32),
            32,
            512,
        ));
        assert!(!trusted_caption_region(
            2000,
            96,
            Geometry::new(1800, 0, 100, 129),
            128,
            512,
        ));
    }
}
