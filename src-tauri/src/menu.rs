//! Native application menu (macOS and Linux). Windows draws no app-level menu, matching
//! ALwith Desktop. Menu clicks reach the focused webview as `menu:*` events.

#[cfg(not(target_os = "windows"))]
use tauri::AppHandle;
#[cfg(not(target_os = "windows"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

pub const OPEN_SETTINGS_ID: &str = "open_settings";
pub const NEW_CHAT_ID: &str = "new_chat";
pub const FIND_IN_CHAT_ID: &str = "find_in_chat";
pub const COMMAND_PALETTE_ID: &str = "command_palette";
pub const OPEN_HOTKEYS_ID: &str = "open_hotkeys";
pub const ZOOM_IN_ID: &str = "zoom_in";
pub const ZOOM_OUT_ID: &str = "zoom_out";
pub const ACTUAL_SIZE_ID: &str = "actual_size";

/// Menu id → frontend event name. Menu clicks and keyboard accelerators share this path.
pub fn event_name(id: &str) -> Option<&'static str> {
    Some(match id {
        OPEN_SETTINGS_ID => "menu:open-settings",
        NEW_CHAT_ID => "menu:new-chat",
        FIND_IN_CHAT_ID => "menu:find-in-chat",
        COMMAND_PALETTE_ID => "menu:command-palette",
        OPEN_HOTKEYS_ID => "menu:open-hotkeys",
        ZOOM_IN_ID => "menu:zoom-in",
        ZOOM_OUT_ID => "menu:zoom-out",
        ACTUAL_SIZE_ID => "menu:actual-size",
        _ => return None,
    })
}

/// The UI language saved by the webview (`preferences.json` → `language`), else the system
/// locale. Only `en` and `zh-CN` exist.
#[cfg(not(target_os = "windows"))]
fn detect_locale(app: &AppHandle) -> &'static str {
    use tauri::Manager;
    let saved = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("preferences.json")).ok())
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|value| {
            value
                .get("language")
                .and_then(|language| language.as_str())
                .map(str::to_owned)
        });
    match saved.as_deref() {
        Some("zh-CN") => return "zh-CN",
        Some("en") => return "en",
        _ => {}
    }
    match sys_locale::get_locale() {
        Some(locale) if locale.starts_with("zh") => "zh-CN",
        _ => "en",
    }
}

#[cfg(not(target_os = "windows"))]
fn t(key: &str, lang: &str) -> &'static str {
    match (lang, key) {
        ("zh-CN", "menu.file") => "文件",
        ("zh-CN", "menu.edit") => "编辑",
        ("zh-CN", "menu.view") => "视图",
        ("zh-CN", "menu.window") => "窗口",
        ("zh-CN", "app.about") => "关于 ALwith ü",
        ("zh-CN", "app.preferences") => "偏好设置…",
        ("zh-CN", "app.services") => "服务",
        ("zh-CN", "app.hide") => "隐藏 ALwith ü",
        ("zh-CN", "app.hideOthers") => "隐藏其他",
        ("zh-CN", "app.showAll") => "全部显示",
        ("zh-CN", "app.quit") => "退出 ALwith ü",
        ("zh-CN", "file.newChat") => "新建对话",
        ("zh-CN", "file.closeWindow") => "关闭窗口",
        ("zh-CN", "edit.undo") => "撤销",
        ("zh-CN", "edit.redo") => "重做",
        ("zh-CN", "edit.cut") => "剪切",
        ("zh-CN", "edit.copy") => "复制",
        ("zh-CN", "edit.paste") => "粘贴",
        ("zh-CN", "edit.selectAll") => "全选",
        ("zh-CN", "edit.find") => "查找",
        ("zh-CN", "view.commandPalette") => "命令面板",
        ("zh-CN", "view.keyboardShortcuts") => "键盘快捷键",
        ("zh-CN", "view.zoomIn") => "放大",
        ("zh-CN", "view.zoomOut") => "缩小",
        ("zh-CN", "view.actualSize") => "实际大小",
        ("zh-CN", "window.minimize") => "最小化",
        ("zh-CN", "window.zoom") => "缩放",
        ("zh-CN", "window.maximize") => "最大化",
        ("zh-CN", "window.toggleFullScreen") => "切换全屏",

        (_, "menu.file") => "File",
        (_, "menu.edit") => "Edit",
        (_, "menu.view") => "View",
        (_, "menu.window") => "Window",
        (_, "app.about") => "About ALwith ü",
        (_, "app.preferences") => "Preferences…",
        (_, "app.services") => "Services",
        (_, "app.hide") => "Hide ALwith ü",
        (_, "app.hideOthers") => "Hide Others",
        (_, "app.showAll") => "Show All",
        (_, "app.quit") => "Quit ALwith ü",
        (_, "file.newChat") => "New Chat",
        (_, "file.closeWindow") => "Close Window",
        (_, "edit.undo") => "Undo",
        (_, "edit.redo") => "Redo",
        (_, "edit.cut") => "Cut",
        (_, "edit.copy") => "Copy",
        (_, "edit.paste") => "Paste",
        (_, "edit.selectAll") => "Select All",
        (_, "edit.find") => "Find",
        (_, "view.commandPalette") => "Command Palette",
        (_, "view.keyboardShortcuts") => "Keyboard Shortcuts",
        (_, "view.zoomIn") => "Zoom In",
        (_, "view.zoomOut") => "Zoom Out",
        (_, "view.actualSize") => "Actual Size",
        (_, "window.minimize") => "Minimize",
        (_, "window.zoom") => "Zoom",
        (_, "window.maximize") => "Maximize",
        (_, "window.toggleFullScreen") => "Toggle Full Screen",
        _ => "",
    }
}

#[cfg(not(target_os = "windows"))]
pub fn build_app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let lang = detect_locale(app);

    #[cfg(target_os = "macos")]
    let app_submenu = {
        let preferences_item =
            MenuItemBuilder::with_id(OPEN_SETTINGS_ID, t("app.preferences", lang))
                .accelerator("Cmd+,")
                .build(app)?;
        SubmenuBuilder::new(app, "ALwith ü")
            .about_with_text(t("app.about", lang), None)
            .separator()
            .item(&preferences_item)
            .separator()
            .services_with_text(t("app.services", lang))
            .separator()
            .hide_with_text(t("app.hide", lang))
            .hide_others_with_text(t("app.hideOthers", lang))
            .show_all_with_text(t("app.showAll", lang))
            .separator()
            .quit_with_text(t("app.quit", lang))
            .build()?
    };

    let new_chat_item = MenuItemBuilder::with_id(NEW_CHAT_ID, t("file.newChat", lang))
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file_submenu = SubmenuBuilder::new(app, t("menu.file", lang))
        .item(&new_chat_item)
        .separator()
        .close_window_with_text(t("file.closeWindow", lang))
        .build()?;

    let find_item = MenuItemBuilder::with_id(FIND_IN_CHAT_ID, t("edit.find", lang))
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let edit_submenu = SubmenuBuilder::new(app, t("menu.edit", lang))
        .undo_with_text(t("edit.undo", lang))
        .redo_with_text(t("edit.redo", lang))
        .separator()
        .cut_with_text(t("edit.cut", lang))
        .copy_with_text(t("edit.copy", lang))
        .paste_with_text(t("edit.paste", lang))
        .select_all_with_text(t("edit.selectAll", lang))
        .separator()
        .item(&find_item)
        .build()?;

    let command_palette_item =
        MenuItemBuilder::with_id(COMMAND_PALETTE_ID, t("view.commandPalette", lang))
            .accelerator("CmdOrCtrl+K")
            .build(app)?;
    let zoom_in_item = MenuItemBuilder::with_id(ZOOM_IN_ID, t("view.zoomIn", lang))
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out_item = MenuItemBuilder::with_id(ZOOM_OUT_ID, t("view.zoomOut", lang))
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let actual_size_item = MenuItemBuilder::with_id(ACTUAL_SIZE_ID, t("view.actualSize", lang))
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let open_hotkeys_item =
        MenuItemBuilder::with_id(OPEN_HOTKEYS_ID, t("view.keyboardShortcuts", lang))
            .accelerator("CmdOrCtrl+/")
            .build(app)?;
    let view_submenu = SubmenuBuilder::new(app, t("menu.view", lang))
        .item(&command_palette_item)
        .separator()
        .item(&zoom_in_item)
        .item(&zoom_out_item)
        .item(&actual_size_item)
        .separator()
        .item(&open_hotkeys_item)
        .build()?;

    let maximize_key = if cfg!(target_os = "macos") {
        "window.zoom"
    } else {
        "window.maximize"
    };
    let window_submenu = SubmenuBuilder::new(app, t("menu.window", lang))
        .minimize_with_text(t("window.minimize", lang))
        .maximize_with_text(t(maximize_key, lang))
        .fullscreen_with_text(t("window.toggleFullScreen", lang))
        .build()?;

    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(&app_submenu);
    menu.item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()
}
