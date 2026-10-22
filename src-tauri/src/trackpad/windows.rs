//! Precision Touchpad HID input observes the normal subclass chain.
//! Windows does not report cancellation when system gestures consume the input.

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::OnceLock;
use std::time::Instant;

use tauri::{AppHandle, Manager};
use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, HidP_GetCaps, HidP_GetUsageValue, HidP_GetUsages,
    HidP_GetValueCaps, HidP_Input,
};
use windows_sys::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, GetRawInputDeviceInfoW, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RID_INPUT, RIDI_PREPARSEDDATA,
    RIM_TYPEHID, RegisterRawInputDevices,
};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, WM_INPUT};

use super::{FrameAssembler, Machine, TouchEntry, TouchFrame, aggregate, emit_gesture};

const USAGE_PAGE_DIGITIZER: u16 = 0x0D;
const USAGE_TOUCH_PAD: u16 = 0x05;
const USAGE_CONTACT_COUNT: u16 = 0x54;
const USAGE_TIP_SWITCH: u16 = 0x42;
const USAGE_PAGE_GENERIC_DESKTOP: u16 = 0x01;
const USAGE_X: u16 = 0x30;
const USAGE_Y: u16 = 0x31;

const SUBCLASS_ID: usize = 0x414c_5447;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();

thread_local! {

    static MACHINE: RefCell<Machine> = RefCell::new(Machine::new());
    static ASSEMBLER: RefCell<FrameAssembler> = RefCell::new(FrameAssembler::new());

    static DEVICE: RefCell<Option<DeviceCaps>> = const { RefCell::new(None) };
}

pub fn reset() {
    MACHINE.with(|machine| *machine.borrow_mut() = Machine::new());
    ASSEMBLER.with(|assembler| *assembler.borrow_mut() = FrameAssembler::new());
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    APP_HANDLE.set(app.clone()).expect("trackpad gestures installed twice");
    START.set(Instant::now()).expect("start instant set once");
    let main = app.get_webview_window("main").expect("main window exists at setup");
    let hwnd = main.hwnd()?.0 as HWND;
    let rid =
        RAWINPUTDEVICE { usUsagePage: USAGE_PAGE_DIGITIZER, usUsage: USAGE_TOUCH_PAD, dwFlags: 0, hwndTarget: hwnd };
    let ok = unsafe { RegisterRawInputDevices(&rid, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _ref_data: usize,
) -> LRESULT {
    if msg == WM_INPUT && unsafe { GetForegroundWindow() } == hwnd {
        handle_raw_input(lparam as *mut c_void);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn handle_raw_input(h_raw_input: *mut c_void) {
    let header_size = std::mem::size_of::<RAWINPUTHEADER>() as u32;
    let mut size = 0u32;
    unsafe { GetRawInputData(h_raw_input, RID_INPUT, std::ptr::null_mut(), &mut size, header_size) };
    if size == 0 {
        return;
    }
    // RAWINPUT contains pointer-sized fields and requires pointer alignment.
    let allocation = (size as usize).max(std::mem::size_of::<RAWINPUT>());
    let mut buf = vec![0usize; allocation.div_ceil(std::mem::size_of::<usize>())];
    let read =
        unsafe { GetRawInputData(h_raw_input, RID_INPUT, buf.as_mut_ptr() as *mut c_void, &mut size, header_size) };
    if read == u32::MAX || (read as usize) < std::mem::offset_of!(RAWINPUT, data) + 8 {
        return;
    }
    let raw = unsafe { &*(buf.as_ptr() as *const RAWINPUT) };
    if raw.header.dwType != RIM_TYPEHID {
        return;
    }
    let ts = START.get().expect("install ran").elapsed().as_secs_f64();
    let hid = unsafe { &raw.data.hid };
    let report_offset = (&hid.bRawData as *const u8 as usize) - (buf.as_ptr() as usize);
    let report_bytes = (hid.dwSizeHid as usize).checked_mul(hid.dwCount as usize);
    if !report_bytes.is_some_and(|bytes| bytes <= (read as usize).saturating_sub(report_offset)) {
        log::warn!("Truncated touchpad raw input");
        return;
    }
    let ok = DEVICE.with(|d| ensure_device_caps(&mut d.borrow_mut(), raw.header.hDevice));
    if !ok {
        return;
    }
    DEVICE.with(|d| {
        let caps_ref = d.borrow();
        let caps = caps_ref.as_ref().expect("ensured above");
        let base = &hid.bRawData as *const u8;
        for i in 0..hid.dwCount {
            let report = unsafe {
                std::slice::from_raw_parts(base.add(i as usize * hid.dwSizeHid as usize), hid.dwSizeHid as usize)
            };
            if let Some(entries) = parse_report(caps, report) {
                let (cc, list) = entries;
                let Some(full) = ASSEMBLER.with(|a| a.borrow_mut().push(cc, list)) else { continue };
                feed_frame(caps, full, ts);
            }
        }
    });
}

fn feed_frame(caps: &DeviceCaps, entries: Vec<TouchEntry>, ts: f64) {
    let positions: Vec<(f64, f64)> = entries.iter().filter(|e| e.tip).map(|e| (e.x, e.y)).collect();
    let touching = positions.len();
    let (centroid, spread) = if touching > 0 { aggregate(&positions) } else { ((0.0, 0.0), 0.0) };
    let frame = TouchFrame { touching, cancelled: 0, centroid, spread, ts, device: caps.device_size };
    let Some(out) = MACHINE.with(|m| m.borrow_mut().step(&frame)) else { return };
    emit_gesture(APP_HANDLE.get().expect("install ran"), out);
}

struct Slot {
    link: u16,
    x_min: i32,
    x_max: i32,
    y_min: i32,
    y_max: i32,
}

struct DeviceCaps {
    handle: HANDLE,

    preparsed: Vec<u8>,
    slots: Vec<Slot>,

    device_size: Option<(f64, f64)>,
}

impl DeviceCaps {
    fn preparsed_ptr(&self) -> isize {
        self.preparsed.as_ptr() as isize
    }
}

fn ensure_device_caps(cache: &mut Option<DeviceCaps>, device: HANDLE) -> bool {
    if let Some(c) = cache.as_ref() {
        if c.handle == device {
            return !c.slots.is_empty();
        }
    }
    reset();
    *cache = load_device_caps(device);
    cache.as_ref().is_some_and(|c| !c.slots.is_empty())
}

fn load_device_caps(device: HANDLE) -> Option<DeviceCaps> {
    let mut size = 0u32;
    unsafe { GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, std::ptr::null_mut(), &mut size) };
    if size == 0 {
        return None;
    }
    let mut preparsed = vec![0u8; size as usize];
    let got =
        unsafe { GetRawInputDeviceInfoW(device, RIDI_PREPARSEDDATA, preparsed.as_mut_ptr() as *mut c_void, &mut size) };
    if got == u32::MAX || got == 0 {
        return None;
    }
    let pd = preparsed.as_ptr() as isize;

    let mut caps = HIDP_CAPS::default();
    if unsafe { HidP_GetCaps(pd, &mut caps) } != HIDP_STATUS_SUCCESS {
        return None;
    }
    let mut n = caps.NumberInputValueCaps;
    if n == 0 {
        return None;
    }
    let mut vcaps = vec![HIDP_VALUE_CAPS::default(); n as usize];
    if unsafe { HidP_GetValueCaps(HidP_Input, vcaps.as_mut_ptr(), &mut n, pd) } != HIDP_STATUS_SUCCESS {
        return None;
    }
    vcaps.truncate(n as usize);

    let covers = |c: &HIDP_VALUE_CAPS, usage: u16| -> bool {
        unsafe {
            if c.IsRange {
                c.Anonymous.Range.UsageMin <= usage && usage <= c.Anonymous.Range.UsageMax
            } else {
                c.Anonymous.NotRange.Usage == usage
            }
        }
    };
    let mut slots: Vec<Slot> = Vec::new();
    let mut device_size: Option<(f64, f64)> = None;
    for c in vcaps.iter().filter(|c| c.UsagePage == USAGE_PAGE_GENERIC_DESKTOP && covers(c, USAGE_X)) {
        let Some(y) = vcaps.iter().find(|yc| {
            yc.UsagePage == USAGE_PAGE_GENERIC_DESKTOP && covers(yc, USAGE_Y) && yc.LinkCollection == c.LinkCollection
        }) else {
            continue;
        };
        if c.LogicalMax <= c.LogicalMin || y.LogicalMax <= y.LogicalMin {
            continue;
        }
        slots.push(Slot {
            link: c.LinkCollection,
            x_min: c.LogicalMin,
            x_max: c.LogicalMax,
            y_min: y.LogicalMin,
            y_max: y.LogicalMax,
        });
        if device_size.is_none() && c.PhysicalMax > c.PhysicalMin && y.PhysicalMax > y.PhysicalMin {
            device_size = Some(((c.PhysicalMax - c.PhysicalMin) as f64, (y.PhysicalMax - y.PhysicalMin) as f64));
        }
    }
    slots.sort_by_key(|s| s.link);
    Some(DeviceCaps { handle: device, preparsed, slots, device_size })
}

fn parse_report(caps: &DeviceCaps, report: &[u8]) -> Option<(usize, Vec<TouchEntry>)> {
    let pd = caps.preparsed_ptr();
    let rp = report.as_ptr();
    let rlen = report.len() as u32;

    let mut cc = 0u32;
    let cc_ok =
        unsafe { HidP_GetUsageValue(HidP_Input, USAGE_PAGE_DIGITIZER, 0, USAGE_CONTACT_COUNT, &mut cc, pd, rp, rlen) }
            == HIDP_STATUS_SUCCESS;

    if !cc_ok {
        return None;
    }

    let mut entries = Vec::with_capacity(caps.slots.len());
    for slot in &caps.slots {
        let mut x = 0u32;
        let mut y = 0u32;
        let x_ok = unsafe {
            HidP_GetUsageValue(HidP_Input, USAGE_PAGE_GENERIC_DESKTOP, slot.link, USAGE_X, &mut x, pd, rp, rlen)
        } == HIDP_STATUS_SUCCESS;
        let y_ok = unsafe {
            HidP_GetUsageValue(HidP_Input, USAGE_PAGE_GENERIC_DESKTOP, slot.link, USAGE_Y, &mut y, pd, rp, rlen)
        } == HIDP_STATUS_SUCCESS;
        if !x_ok || !y_ok {
            continue;
        }

        let mut usages = [0u16; 16];
        let mut ulen = usages.len() as u32;
        let st = unsafe {
            HidP_GetUsages(
                HidP_Input,
                USAGE_PAGE_DIGITIZER,
                slot.link,
                usages.as_mut_ptr(),
                &mut ulen,
                pd,
                rp as *mut u8,
                rlen,
            )
        };
        let tip = st == HIDP_STATUS_SUCCESS
            && usages.get(..ulen as usize).is_some_and(|values| values.contains(&USAGE_TIP_SWITCH));
        entries.push(TouchEntry {
            tip,
            x: (x as f64 - slot.x_min as f64) / (slot.x_max - slot.x_min) as f64,
            y: (y as f64 - slot.y_min as f64) / (slot.y_max - slot.y_min) as f64,
        });
    }
    Some((cc as usize, entries))
}
