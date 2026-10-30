use super::WindowAction;
struct NativeHandle(windows_sys::Win32::Foundation::HWND);
impl raw_window_handle::HasWindowHandle for NativeHandle {
    fn window_handle(&self) -> Result<raw_window_handle::WindowHandle<'_>, raw_window_handle::HandleError> {
        let hwnd = std::num::NonZeroIsize::new(self.0 as isize).ok_or(raw_window_handle::HandleError::Unavailable)?;
        let raw = raw_window_handle::RawWindowHandle::Win32(raw_window_handle::Win32WindowHandle::new(hwnd));
        // SAFETY: the host retains the live HWND for the entire native operation.
        Ok(unsafe { raw_window_handle::WindowHandle::borrow_raw(raw) })
    }
}
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
        WindowsAndMessaging::{
            GWL_EXSTYLE, GetCursorPos, GetWindowLongPtrW, GetWindowRect, HWND_TOPMOST, SW_HIDE, SW_SHOWNOACTIVATE,
            SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetForegroundWindow, SetWindowLongPtrW,
            SetWindowPos, ShowWindow, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    },
};

unsafe fn bubble(window: HWND, parent: HWND, dimensions: Option<(f64, f64)>) -> Result<(), String> {
    let mut pet: RECT = unsafe { std::mem::zeroed() };
    let mut child: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(parent, &mut pet) } == 0 || unsafe { GetWindowRect(window, &mut child) } == 0 {
        return Err("Native window bounds unavailable".into());
    }
    let mut monitor: MONITORINFO = unsafe { std::mem::zeroed() };
    monitor.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(MonitorFromWindow(parent, MONITOR_DEFAULTTONEAREST), &mut monitor) } == 0 {
        return Err("Pet monitor unavailable".into());
    }
    let dpi = unsafe { windows_sys::Win32::UI::HiDpi::GetDpiForWindow(parent) };
    if dpi == 0 {
        return Err("Pet window scale unavailable".into());
    }
    let dpi = dpi as f64 / 96.0;
    let (width, height) = dimensions
        .map(|(w, h)| ((w * dpi).round() as i32, (h * dpi).round() as i32))
        .unwrap_or((child.right - child.left, child.bottom - child.top));
    let x = (pet.left + (pet.right - pet.left - width) / 2)
        .clamp(monitor.rcWork.left, (monitor.rcWork.right - width).max(monitor.rcWork.left));
    let y = (if pet.top - height >= monitor.rcWork.top { pet.top - height } else { pet.bottom })
        .clamp(monitor.rcWork.top, (monitor.rcWork.bottom - height).max(monitor.rcWork.top));
    if unsafe { SetWindowPos(window, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE) } == 0 {
        return Err("Could not position pet bubble".into());
    }
    Ok(())
}
pub(super) fn apply(action: WindowAction) -> Result<(), String> {
    let window = action.handle as HWND;
    // SAFETY: all HWNDs are supplied by the application from retained live windows.
    unsafe {
        match action.action.as_str() {
            "focus" => {
                SetForegroundWindow(window);
            }
            "blur" => {
                let handle = NativeHandle(window);
                if action.radius != Some(0) && action.path.is_some() {
                    window_vibrancy::apply_acrylic(&handle, None)
                } else {
                    window_vibrancy::clear_acrylic(&handle)
                }
                .map_err(|error| error.to_string())?;
            }
            "prepare" => {
                let mut style = GetWindowLongPtrW(window, GWL_EXSTYLE) | WS_EX_TOOLWINDOW as isize;
                if action.role == "pet" {
                    style |= WS_EX_NOACTIVATE as isize;
                }
                SetWindowLongPtrW(window, GWL_EXSTYLE, style);
                if SetWindowPos(
                    window,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err("Could not prepare pet window".into());
                }
            }
            "present" => {
                ShowWindow(window, SW_SHOWNOACTIVATE);
            }
            "hide" => {
                ShowWindow(window, SW_HIDE);
            }
            "sound" => {
                let directory = std::env::var("WINDIR").map_err(|_| "Windows directory unavailable")?;
                let path: Vec<u16> = format!("{directory}\\Media\\Windows Recycle.wav")
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                windows_sys::Win32::Media::Audio::PlaySoundW(
                    path.as_ptr(),
                    std::ptr::null_mut(),
                    windows_sys::Win32::Media::Audio::SND_FILENAME
                        | windows_sys::Win32::Media::Audio::SND_ASYNC
                        | windows_sys::Win32::Media::Audio::SND_NODEFAULT,
                );
            }
            "detach" | "forget" => {}
            "move" => {
                if SetWindowPos(
                    window,
                    HWND_TOPMOST,
                    action.x.ok_or("Missing x")?,
                    action.y.ok_or("Missing y")?,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE,
                ) == 0
                {
                    return Err("Could not move pet".into());
                }
                if let Some(child) = action.parent {
                    bubble(child as HWND, window, None)?;
                }
            }
            "bubble" | "bubble-resize" => {
                bubble(
                    window,
                    action.parent.ok_or("Bubble parent unavailable")? as HWND,
                    action.width.zip(action.height),
                )?;
                if action.action == "bubble" {
                    ShowWindow(window, SW_SHOWNOACTIVATE);
                }
            }
            "drag" => {
                let mut cursor: POINT = std::mem::zeroed();
                let mut rect: RECT = std::mem::zeroed();
                if GetCursorPos(&mut cursor) == 0 || GetWindowRect(window, &mut rect) == 0 {
                    return Err("Pet drag position unavailable".into());
                }
                let dx = cursor.x - rect.left;
                let dy = cursor.y - rect.top;
                while GetAsyncKeyState(VK_LBUTTON as i32) < 0 {
                    if GetCursorPos(&mut cursor) == 0 {
                        return Err("Pet drag cursor unavailable".into());
                    }
                    SetWindowPos(window, HWND_TOPMOST, cursor.x - dx, cursor.y - dy, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
                    if let Some(child) = action.parent {
                        bubble(child as HWND, window, None)?;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(16));
                }
            }
            _ => return Err("Unsupported native pet action".into()),
        }
    }
    Ok(())
}
