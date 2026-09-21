//! Chat window policy adapted from Desktop; extraction candidates: .docs/modules.md.
use tauri::{Manager, WebviewWindow};
#[cfg(target_os = "macos")]
mod ime_candidates;
pub mod plugin;
mod resize;
pub use plugin::init;

pub fn is_overlay(label: &str) -> bool {
    label == "chat"
}
#[cfg(target_os = "macos")]
pub fn install_input_observer() {
    ime_candidates::install();
}
#[cfg(target_os = "macos")]
pub fn update_input_candidates() {
    ime_candidates::update();
}

/// 调用方必须等待初始化完成后再显示或聚焦。
pub async fn prepare(window: &WebviewWindow) -> Result<(), String> {
    if !is_overlay(window.label()) {
        return Err(format!("Window {} is not an overlay", window.label()));
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let handle = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(initialize(&handle));
            })
            .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    window.set_always_on_top(true).map_err(|error| error.to_string())?;
    Ok(())
}

// 不设置 is_floating_panel：Tao 0.35.3 的置顶写入和查询都使用层级 5，
// AppKit setFloatingPanel 会改为 3，导致 Tauri 查询与实际策略不一致。
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(DesktopChatPanel {
        config: {
            can_become_key_window: true,
            // 保留现有聊天面板的菜单快捷键校验能力，非激活由样式位保证。
            can_become_main_window: true,
            hides_on_deactivate: false
        }
    })
}

#[cfg(target_os = "macos")]
fn initialize(window: &WebviewWindow) -> Result<(), String> {
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindow};
    use tauri_nspanel::WebviewWindowExt;

    objc2::MainThreadMarker::new().expect("Overlay initialization requires the main thread");
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: 存活的 Tauri 窗口，在主线程访问。转换后重新取得引用。
    let native = unsafe { &*(pointer as *const NSWindow) };
    let first_responder = native.firstResponder();
    if !native.isKindOfClass(NSPanel::class()) {
        // WKWebView 的 KVO 必须先注销再换类，不能覆盖观察器生成的动态子类。
        // 已转换的窗口绝不二次换类，否则会破坏成为 key 后注册的 TouchBar KVO。
        let content = native.contentView().expect("Overlay must have a content view");
        let views = content.subviews();
        for view in views.iter() {
            view.removeFromSuperview();
        }
        window.to_panel::<DesktopChatPanel>().expect("Failed to create desktop chat panel");
        for view in views.iter() {
            content.addSubview(&view);
        }
    }
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    // SAFETY: 同一个存活窗口，类转换已结束，仍在主线程。
    let native = unsafe { &*(pointer as *const NSWindow) };
    restore(native);
    // 摘挂 WKWebView 会重置响应者；恢复原输入目标，不改变窗口的 key 状态。
    assert!(native.makeFirstResponder(first_responder.as_deref()), "Failed to restore overlay input responder");
    Ok(())
}

/// 只恢复属性，不显示、不移动、不抢焦点；可用于 Space 切换和唤醒。
#[cfg(target_os = "macos")]
pub fn restore(window: &objc2_app_kit::NSWindow) {
    use objc2::ClassType;
    use objc2_app_kit::{NSPanel, NSWindowCollectionBehavior as Behavior, NSWindowStyleMask};

    objc2::MainThreadMarker::new().expect("Overlay policy requires the main thread");
    assert!(window.isKindOfClass(NSPanel::class()), "Overlay must be initialized before display");
    let style = window.styleMask() | NSWindowStyleMask::NonactivatingPanel;
    if window.styleMask() != style {
        let first_responder = window.firstResponder();
        window.setStyleMask(style);
        // 与 Tao toggle_style_mask 一致：修改样式后必须恢复键盘响应链。
        assert!(
            window.makeFirstResponder(first_responder.as_deref()),
            "Failed to restore overlay input responder after style change"
        );
    }
    let conflicts = Behavior::Managed
        | Behavior::Transient
        | Behavior::MoveToActiveSpace
        | Behavior::Primary
        | Behavior::Auxiliary
        | Behavior::FullScreenPrimary
        | Behavior::FullScreenNone
        | Behavior::FullScreenAllowsTiling;
    let behavior = (window.collectionBehavior() & !conflicts)
        | Behavior::Stationary
        | Behavior::CanJoinAllSpaces
        | Behavior::CanJoinAllApplications
        | Behavior::FullScreenAuxiliary
        | Behavior::FullScreenDisallowsTiling;
    if window.collectionBehavior() != behavior {
        window.setCollectionBehavior(behavior);
    }
    // 与当前 Tao 的 set_always_on_top / is_always_on_top 保持一致。
    const TOPMOST_LEVEL: isize = 5;
    if window.level() != TOPMOST_LEVEL {
        window.setLevel(TOPMOST_LEVEL);
    }
}
