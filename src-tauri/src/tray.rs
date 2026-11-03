//! The resident host remains reachable when its main window is hidden.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

const VIBEMON: &str = "tray-vibemon";

struct TrayVibemon(CheckMenuItem<tauri::DynRuntime>);

/// Native window transitions own the checkmark, including closes outside the tray.
pub fn set_vibemon_checked(app: &tauri::AppHandle, checked: bool) {
    if let Err(error) = app.state::<TrayVibemon>().0.set_checked(checked) {
        log::error!("Cannot update tray vibemon state: {error}");
    }
}

pub fn initialize(app: &tauri::AppHandle) -> tauri::Result<()> {
    let chinese = crate::menu::detect_locale(app) == "zh-CN";
    let show = MenuItem::with_id(
        app,
        "tray-show",
        if chinese { "打开 ALwith U" } else { "Open ALwith U" },
        true,
        None::<&str>,
    )?;
    let vibemon = CheckMenuItem::with_id(app, VIBEMON, "Vibémon", false, false, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "tray-quit",
        if chinese { "退出 ALwith U" } else { "Quit ALwith U" },
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &vibemon, &separator, &quit])?;
    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("icons/tray-icon.png");
    #[cfg(not(target_os = "macos"))]
    let icon = app.default_window_icon().expect("application icon is configured").clone();
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("ALwith U")
        .menu(&menu)
        // Match Desktop: clicking the status icon exposes all three actions.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if crate::window::is_closing(app) {
                return;
            }
            let result = match event.id().as_ref() {
                "tray-show" => crate::window::show_main_window(app.clone()),
                VIBEMON => {
                    // Check items toggle automatically; retain actual visibility until the action succeeds.
                    let visible = app.get_webview_window("vibemon").map(|vibemon| vibemon.is_visible()).transpose();
                    match visible {
                        Ok(visible) => {
                            set_vibemon_checked(app, visible.unwrap_or(false));
                            app.emit_to("main", "tray:toggle-vibemon", ()).map_err(|error| error.to_string())
                        }
                        Err(error) => Err(error.to_string()),
                    }
                }
                "tray-quit" => {
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                log::error!("Tray action failed: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
            ) && !crate::window::is_closing(tray.app_handle())
                && let Err(error) = crate::window::show_main_window(tray.app_handle().clone())
            {
                log::error!("Cannot reopen main window from tray: {error}");
            }
        })
        .build(app)?;
    app.manage(TrayVibemon(vibemon));
    Ok(())
}

#[tauri3_specta::command]
pub fn tray_vibemon_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main may register the vibemon host".into());
    }
    window.state::<TrayVibemon>().0.set_enabled(true).map_err(|error| error.to_string())
}
