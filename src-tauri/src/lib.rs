mod browser_bridge;
#[cfg(test)]
mod codex_launcher;
mod power;

#[cfg(all(test, target_os = "macos"))]
#[path = "__tests__/dropped_file_url.rs"]
mod dropped_file_url_tests;

mod appearance;
mod autostart;
mod bundled_extensions;
mod chat_files;
mod chat_window;
mod computer;
mod draft_directory;
mod drive;
mod extension_capabilities;
mod extension_inbox;
mod extension_wire;
#[cfg(target_os = "macos")]
mod fullscreen_controls;
mod gamepad;
mod html_preview;
mod imports;
mod installed_apps;
mod legacy_extensions;
mod menu;
mod mobile;
mod native;
#[cfg(target_os = "macos")]
mod panel;
mod panic_report;
mod providers;
mod runtime;
mod secret_store;
mod settings;
mod settings_store;
use atlas_tauri as trackpad;
mod tray;
mod updater;
mod vibemon;
mod voice;
mod voice_credentials;
mod window;
#[cfg(target_os = "windows")]
mod windows_frame;
mod workbuddy;
mod workspace;
mod workspace_move;

use tauri::{Emitter, Manager};

fn application_context() -> tauri::Context {
    tauri::generate_context!()
}

pub fn run() {
    let login_launch = autostart::LoginLaunch::new(std::env::args());
    let mut context = application_context();
    if login_launch.started_hidden() {
        let main = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
            .expect("main window is configured");
        main.visible = false;
        main.focus = false;
    }

    let builder = tauri::Builder::default()
        .plugin(alwith_module_store::tauri::init())
        .plugin(alwith_auth_client::tauri::init(native::development_directory()))
        .manage(login_launch)
        .register_asynchronous_uri_scheme_protocol("preview-html", html_preview::handle_protocol)
        .runtime(tauri_runtime_wry::Wry::default())
        // Second launch: focus the running instance instead of starting a second alwith-runtime
        // against the same ~/.codex.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            log::info!("second instance argv={argv:?} cwd={cwd:?}");
            if window::is_closing(app) {
                return;
            }
            if argv.iter().any(|argument| argument == autostart::ARGUMENT) {
                return;
            }
            if let Err(error) = window::show_main_window(app.clone()) {
                log::error!("Cannot reopen main window: {error}");
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init()).plugin(fullscreen_controls::init());

    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_decoration::init());

    let builder = builder
        .plugin(chat_window::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(alwith_extension::plugin::init_with_paths(None, native::development_directory()))
        .plugin(appearance::wallpaper::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![autostart::ARGUMENT]),
        ))
        // Chat is created hidden before converting it to NSPanel. Restoring visibility here
        // would focus an unprepared NSWindow and break AppKit's keyboard/KVO lifecycle.
        // Settings has a fixed logical size; cached physical sizes must not override it.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Shutdown hides windows before draining IPC. Each launch must still
                // show main according to its config, rather than restore that hidden state.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["chat", "settings", "vibemon", "bubble-menu-vibemon"])
                // Windows guide windows must not restore their legacy undecorated state.
                .map_label(|label| if cfg!(target_os = "windows") && label == "guide" { "guide-native" } else { label })
                .build(),
        )
        .manage(legacy_extensions::files::LegacyFiles::default())
        .manage(legacy_extensions::importer::LegacyImports::default())
        .manage(runtime::RuntimeState::default())
        .manage(power::PreventSleep::default())
        .manage(extension_inbox::InboxState::default())
        .manage(vibemon::BubblePresentation::default());

    #[cfg(feature = "hasgard-testing")]
    let builder = builder.plugin(tauri_plugin_hasgard::init());

    let app = builder
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            fullscreen_controls::on_window_event(window, event);
            if matches!(event, tauri::WindowEvent::Destroyed) {
                voice::detach(window.app_handle(), window.label());
            }
        })
        .on_menu_event(|app, event| {
            if event.id().0 == menu::QUIT_ID {
                app.exit(0);
                return;
            }
            if window::is_closing(app) {
                return;
            }
            if event.id().0 == "vibemon-close" {
                let _ = app.emit_to("main", "vibemon:close", ());
                return;
            }
            let Some(event_name) = menu::event_name(event.id().0.as_str()) else {
                return;
            };
            if let Some(focused) = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false)) {
                let _ = app.emit_to(focused.label(), event_name, ());
            }
        })
        .setup(|app| {
            match app.path().app_log_dir() {
                Ok(directory) => panic_report::install(directory.join("panic.log")),
                Err(error) => log::warn!("Cannot resolve panic report directory: {error}"),
            }
            app.manage(native::Native::load(app.handle())?);
            mobile::initialize(app.handle())?;
            settings::initialize(app.handle())?;
            voice::initialize(app.handle())?;
            app.manage(providers::Providers::load(app.handle())?);
            drive::initialize(app.handle())?;
            gamepad::initialize(app.handle())?;
            tauri_plugin_alwith_desktop_shell::install_native(app.handle())?;
            computer::initialize(app.handle())?;
            log::info!("ALwith U {} starting", env!("CARGO_PKG_VERSION"));
            #[cfg(target_os = "windows")]
            app.get_webview_window("main").expect("main window exists at setup").hide()?;
            // Windows draws no app-level menu (it would surface on every window); macOS wants
            // one NSApp menu and Linux a per-window one. Built here, not in `Builder::menu`,
            // because the locale lookup needs the path resolver, which exists only after build.
            #[cfg(not(target_os = "windows"))]
            app.set_menu(menu::build_app_menu(app.handle())?)?;
            tray::initialize(app.handle())?;
            updater::init(app);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            match payload.event() {
                tauri::webview::PageLoadEvent::Started => voice::detach(webview.app_handle(), webview.label()),
                tauri::webview::PageLoadEvent::Finished => voice::document_ready(webview.app_handle(), webview.label()),
            }
            #[cfg(target_os = "windows")]
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.app_handle().get_webview_window("main").expect("main window exists on page load");
                tauri::async_runtime::spawn(windows_frame::activate(window));
            }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                extension_inbox::window_closed(webview.app_handle(), webview.label());
            }
            if webview.label() == "bubble-menu-vibemon"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
                && let Some(window) = webview.app_handle().get_webview_window(webview.label())
            {
                vibemon::reset_bubble_on_navigation(window);
            }
            log::info!("page {:?} {}", payload.event(), payload.url());
            let _ = webview;
        })
        .invoke_handler({
            let typed = bindings().invoke_handler();
            #[cfg(target_os = "macos")]
            let binary: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                voice::voice_push,
                settings::settings_request,
                fullscreen_controls::set_traffic_light_zoom
            ];
            #[cfg(not(target_os = "macos"))]
            let binary: fn(tauri::ipc::Invoke) -> bool =
                tauri::generate_handler![voice::voice_push, settings::settings_request];
            move |invoke| {
                if matches!(invoke.message.command(), "voice_push" | "settings_request" | "set_traffic_light_zoom") {
                    binary(invoke)
                } else {
                    typed(invoke)
                }
            }
        })
        .build(context)
        .expect("error while building ALwith U");
    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } if !window::is_closing(app) => {
            if let Err(error) = window::show_main_window(app.clone()) {
                log::error!("Cannot reopen main window: {error}");
            }
        }
        // The main webview hosts background services and remains alive when closed.
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. }
            if label == "main" =>
        {
            api.prevent_close();
            let window = app.get_webview_window("main").expect("main window exists on close");
            if let Err(error) = window.hide() {
                log::error!("Cannot hide main window: {error}");
            }
        }
        // Unexpected destruction cannot leave background services without their host.
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => {
            app.exit(0);
        }
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
            if label == "vibemon" {
                tray::set_pet_checked(app, false);
            }
            #[cfg(target_os = "macos")]
            panel::closed(app, &label);
            extension_inbox::window_closed(app, &label);
            gamepad::window_destroyed(app, &label);
        }
        tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Focused(false), .. } => {
            gamepad::window_inactive(app, &label);
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            let closing = window::is_closing(app);
            if (!closing && workspace::prevent_exit(app))
                || drive::prevent_exit(app, code)
                || runtime::prevent_exit(app, code)
            {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            app.state::<alwith_computer::ComputerHost>().kill_on_exit();
            voice::shutdown(app);
            gamepad::shutdown(app);
            power::sync(app, false);
            app.state::<runtime::RuntimeState>().kill_on_exit();
        }
        _ => {}
    });
}

/// The native handler and TypeScript exporter use this same command and event graph.
pub fn bindings() -> tauri3_specta::Bindings {
    macro_rules! commands {
        ($($platform:path),* $(,)?) => {
            tauri3_specta::commands![
                $($platform,)*
                autostart::autostart_status,
                computer::computer_status,
                computer::computer_start,
                computer::computer_reconnect,
                computer::computer_stop,
                computer::computer_context,
                computer::computer_revision,
                computer::computer_bind,
                computer::computer_ready,
                computer::computer_stop_session,
                computer::computer_subscribe,
                computer::computer_focus,
                computer::computer_unsubscribe,
                computer::computer_request_permissions,
                autostart::autostart_set,
                autostart::autostart_launch,
                autostart::autostart_complete,
                window::show_main_window,
                tray::tray_pet_ready,
                extension_inbox::extension_inbox_scan,
                extension_inbox::extension_inbox_scan_extension,
                extension_inbox::extension_inbox_finish,
                extension_inbox::extension_inbox_prepare,
                extension_inbox::extension_inbox_complete,
                extension_inbox::extension_inbox_failed,
                draft_directory::draft_directory,
                workbuddy::workbuddy_create,
                imports::prepare_cursor_import,
                voice::voice_start,
                voice::voice_control,
                voice::voice_profiles,
                voice::voice_save_credential,
                voice::voice_delete_credential,
                gamepad::gamepad_request,
                gamepad::gamepad_permission,
                gamepad::gamepad_capture,
                gamepad::gamepad_catalog,
                providers::gamepad_ai_prepare,
                drive::drive_request,
                drive::drive_path_exists,
                chat_files::chat_save_file,
                chat_files::chat_write_text_attachment,
                chat_files::chat_read_image,
                chat_files::chat_preview_file,
                chat_files::chat_read_dropped_file,
                workspace::workspace_open,
                workspace::workspace_list_files,
                workspace::workspace_import,
                workspace::workspace_file,
                workspace::workspace_watch,
                workspace::workspace_dirty,
                workspace::workspace_exit,
                html_preview::html_preview_open,
                html_preview::html_preview_close,
                workspace_move::workspace_move_to,
                bundled_extensions::extension_bundles,
                legacy_extensions::importer::extension_prepare_install,
                legacy_extensions::importer::legacy_stage_import,
                legacy_extensions::importer::legacy_take_initial_data,
                legacy_extensions::importer::legacy_ack_initial_data,
                legacy_extensions::importer::legacy_cleanup_import,
                legacy_extensions::http::legacy_http,
                legacy_extensions::http::extension_http,
                extension_capabilities::extension_cleanup_grants,
                legacy_extensions::files::extension_file,
                legacy_extensions::files::extension_directories,
                legacy_extensions::files::extension_pick_directory,
                legacy_extensions::files::legacy_file,
                legacy_extensions::business_sharing::legacy_share_business,
                legacy_extensions::files::legacy_directories,
                legacy_extensions::files::legacy_pick_directory,
                appearance::wallpaper::wallpaper_list,
                appearance::wallpaper::wallpaper_import,
                appearance::wallpaper::wallpaper_remove,
                vibemon::vibemon_window,
                vibemon::vibemon_resource,
                vibemon::vibemon_download,
                vibemon::vibemon_claim,
                chat_window::plugin::present_chat_window,
                chat_window::plugin::resize_chat_window,
                runtime::runtime_start,
                runtime::runtime_send,
                runtime::codex_version,
                mobile::mobile_set_activity_sessions,
                mobile::mobile_bridge_start,
                mobile::mobile_bridge_stop,
                mobile::mobile_bridge_status,
                mobile::bridge_set_active_session,
                mobile::bridge_prompt_result,
                mobile::bridge_pairing_start,
                mobile::bridge_identity,
                mobile::bridge_trusted_list,
                mobile::bridge_trusted_revoke,
                providers::managed::providers_account_bind,
                providers::managed::providers_refresh_managed,
                providers::managed::providers_clear_managed,
                providers::providers_read,
                providers::providers_save,
                providers::providers_save_custom,
                providers::providers_remove_custom,
                providers::providers_test,
                providers::providers_apply,
                updater::commands::updater_get_state,
                updater::commands::updater_install_and_relaunch,
                window::attach_window_to_main,
                installed_apps::read_apps_info,
                browser_bridge::chrome_extension_installed,
                browser_bridge::chrome_bridge_installed,
                browser_bridge::set_chrome_bridge_enabled,
                installed_apps::default_browser,
                installed_apps::is_app_running,
                installed_apps::open_app_by_id,
                installed_apps::open_path_in_app
            ]
            .event::<trackpad::TrackpadGesture>()
            .event::<runtime::RuntimeLines>()
            .event::<computer::ComputerPreview>()
            .event::<runtime::RuntimeExit>()
            .event::<providers::Snapshot>()
            .event::<providers::managed::RevokedSessions>()
            .event::<updater::state::State>()
            .event::<menu::OpenSettings>()
            .event::<menu::NewChat>()
            .event::<menu::NewTab>()
            .event::<menu::CloseTab>()
            .event::<menu::ReopenTab>()
            .event::<menu::ProjectTree>()
            .event::<menu::FindInChat>()
            .event::<menu::ReplaceInFile>()
            .event::<menu::EditUndo>()
            .event::<menu::EditRedo>()
            .event::<menu::CommandPalette>()
            .event::<menu::OpenHotkeys>()
            .event::<menu::ZoomIn>()
            .event::<menu::ZoomOut>()
            .event::<menu::ActualSize>()
        };
    }
    commands![]
}
