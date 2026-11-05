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
mod diagnostics;
mod draft_directory;
mod drive;
mod enterprise;
mod extension_capabilities;
mod extension_inbox;
mod extension_wire;
#[cfg(target_os = "macos")]
mod fullscreen_controls;
mod gamepad;
mod html_preview;
mod imports;
mod legacy_extensions;
mod menu;
mod mobile;
mod native;
#[cfg(target_os = "macos")]
mod panel;
mod panic_report;
mod runtime;
mod secret_store;
mod settings;
mod settings_store;
use atlas_tauri as trackpad;
mod tray;
mod vibemon;
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

    let voice_credentials = settings::VoiceCredentials::default();
    let builder = tauri::Builder::default()
        .plugin(alwith_desktop_shell::init_native())
        .plugin(alwith_store::init())
        // U keeps its own vibemon windows; the auth plugin only refreshes tokens here.
        .plugin(alwith_auth::init(alwith_auth::Config {
            development_directory: native::development_directory(),
            vibemon: None,
        }))
        .manage(login_launch)
        .manage(enterprise::Enterprise::default())
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .format(|out, message, record| {
                    diagnostics::native_log(record.level(), &message.to_string());
                    out.finish(format_args!(
                        "[{:?}][{}][{}] {message}",
                        std::time::SystemTime::now(),
                        record.level(),
                        record.target()
                    ));
                })
                .build(),
        )
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
        .plugin(alwith_extension::init(alwith_extension::Config {
            root: None,
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_fs::init(alwith_fs::Config {
            coordinator: Some(std::sync::Arc::new(workspace::Coordinator)),
            development_directory: native::development_directory(),
        }))
        .plugin(drive::plugin())
        .plugin(appearance::wallpaper::plugin())
        .plugin(alwith_editor::init(alwith_editor::Config { development_directory: native::development_directory() }))
        .plugin(alwith_computer::init(alwith_computer::Config {
            development_directory: native::development_directory(),
            proxy: native::development_resources().map(|resources| resources.join("computer/stdio.mjs")),
            observer: Some(diagnostics::computer_observer()),
            ..Default::default()
        }))
        .plugin(alwith_device::init(alwith_device::DeviceConfig {
            resources: native::development_resources(),
            development_directory: native::development_directory(),
            ..Default::default()
        }))
        .plugin(alwith_voice::init(
            voice_credentials.clone(),
            alwith_voice::Config { development_directory: native::development_directory() },
        ))
        .plugin(alwith_gamepad::init(alwith_gamepad::Config {
            development_directory: native::development_directory(),
            ..Default::default()
        }))
        .plugin(alwith_installed_apps::init(alwith_installed_apps::Config {
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_mobile::init(
            alwith_mobile::MobileConfig {
                host_app: alwith_mobile::HostApp::U,
                development_directory: native::development_directory(),
            },
            mobile::Host,
        ))
        .plugin(alwith_browser::init(
            |_| runtime::sidecar_path("bun"),
            native::development_resources().map(|resources| resources.join(alwith_browser::BRIDGE_RESOURCE)),
        ))
        .plugin(alwith_chat::init_with_account(runtime::ChatRuntime, native::development_directory()))
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
        .manage(voice_credentials)
        .manage(power::PreventSleep::default())
        .manage(extension_inbox::InboxState::default())
        .manage(vibemon::BubblePresentation::default());

    #[cfg(feature = "hasgard-testing")]
    let builder = builder.plugin(tauri_plugin_hasgard::init());

    let app = builder
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            fullscreen_controls::on_window_event(window, event);
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
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
                if let Err(error) = app.emit_to("main", "vibemon:close", ()) {
                    log::error!("Cannot emit event: {error}");
                }
                return;
            }
            let Some(event_name) = menu::event_name(event.id().0.as_str()) else {
                return;
            };
            if let Some(focused) = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false))
                && let Err(error) = app.emit_to(focused.label(), event_name, ())
            {
                log::error!("Cannot emit event: {error}");
            }
        })
        .setup(|app| {
            diagnostics::install(app.handle())?;
            match app.path().app_log_dir() {
                Ok(directory) => panic_report::install(directory.join("panic.log")),
                Err(error) => log::warn!("Cannot resolve panic report directory: {error}"),
            }
            settings::initialize(app.handle())?;
            log::info!("ALwith U {} starting", env!("CARGO_PKG_VERSION"));
            #[cfg(target_os = "windows")]
            app.get_webview_window("main").expect("main window exists at setup").hide()?;
            // Windows draws no app-level menu (it would surface on every window); macOS wants
            // one NSApp menu and Linux a per-window one. Built here, not in `Builder::menu`,
            // because the locale lookup needs the path resolver, which exists only after build.
            #[cfg(not(target_os = "windows"))]
            app.set_menu(menu::build_app_menu(app.handle())?)?;
            tray::initialize(app.handle())?;
            Ok(())
        })
        .on_page_load(|webview, payload| {
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
            let binary: fn(tauri::ipc::Invoke) -> bool =
                tauri::generate_handler![settings::settings_request, fullscreen_controls::set_traffic_light_zoom];
            #[cfg(not(target_os = "macos"))]
            let binary: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![settings::settings_request];
            move |invoke| {
                if matches!(invoke.message.command(), "settings_request" | "set_traffic_light_zoom") {
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
                tray::set_vibemon_checked(app, false);
            }
            #[cfg(target_os = "macos")]
            panel::closed(app, &label);
            extension_inbox::window_closed(app, &label);
            gamepad::window_destroyed(app, &label);
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
            // Last resort when native termination bypassed the ordered shutdown in ExitRequested.
            if let Err(error) = app.state::<alwith_computer::Computer>().kill_on_exit() {
                log::error!("Computer driver kill failed: {error}");
            }
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
                diagnostics::diagnostics_export,
                autostart::autostart_set,
                autostart::autostart_launch,
                autostart::autostart_complete,
                window::show_main_window,
                tray::tray_vibemon_ready,
                extension_inbox::extension_inbox_scan,
                extension_inbox::extension_inbox_scan_extension,
                extension_inbox::extension_inbox_finish,
                extension_inbox::extension_inbox_prepare,
                extension_inbox::extension_inbox_complete,
                extension_inbox::extension_inbox_failed,
                draft_directory::draft_directory,
                workbuddy::workbuddy_create,
                imports::prepare_cursor_import,
                drive::drive_path_exists,
                chat_files::chat_save_file,
                chat_files::chat_write_text_attachment,
                chat_files::chat_read_image,
                chat_files::chat_preview_file,
                chat_files::chat_read_dropped_file,
                chat_files::chat_clipboard_file_paths,
                chat_files::chat_write_pasted_file,
                workspace::workspace_import,
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
                runtime::codex_status,
                mobile::mobile_set_activity_sessions,
                gamepad::gamepad_ai_prepare,
                enterprise::enterprise_bind,
                enterprise::enterprise_refresh,
                enterprise::enterprise_catalog,
                enterprise::enterprise_clear,
                enterprise::enterprise_status,
                enterprise::enterprise_begin,
                enterprise::enterprise_cancel,
                enterprise::enterprise_update_account,
                enterprise::enterprise_logout,
                window::attach_window_to_main,
            ]
            .event::<trackpad::TrackpadGesture>()
            .event::<runtime::RuntimeLines>()
            .event::<runtime::RuntimeExit>()
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
