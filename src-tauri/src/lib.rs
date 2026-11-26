mod codex_home;
mod docs_install;
mod power;

#[cfg(all(test, target_os = "macos"))]
#[path = "__tests__/dropped_file_url.rs"]
mod dropped_file_url_tests;

mod appearance;
mod autostart;
#[cfg(feature = "runtime-cef")]
mod browser_ai;
#[cfg(feature = "runtime-cef")]
mod browser_chrome;
#[cfg(feature = "runtime-cef")]
mod browser_extensions;
#[cfg(feature = "runtime-cef")]
mod browser_logins;
#[cfg(feature = "runtime-cef")]
mod browser_point;
#[cfg(feature = "runtime-cef")]
mod browser_protocol;
#[cfg(all(test, feature = "runtime-cef"))]
#[path = "../../node_modules/@nyssance/cef-rs/rust/sys/runtime_output.rs"]
mod browser_runtime_output;
#[cfg(feature = "runtime-cef")]
mod browser_site;
mod bundled_extensions;
#[cfg(feature = "runtime-cef")]
mod cef_runtime;
mod chat_window;
mod desktop_runtime;
#[cfg(feature = "dev-backends")]
mod development_instance;
mod device_window;
mod diagnostics;
mod draft_directory;
mod drive;
mod enterprise;
mod extension_capabilities;
mod extension_inbox;
mod extension_wire;
mod gamepad;
mod generated_images;
mod html_preview;
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
#[cfg(feature = "runtime-cef")]
mod web_automation;
use atlas_tauri as trackpad;
mod create_alwith;
mod tray;
mod vibemon;
mod window;
mod window_state;
#[cfg(all(test, target_os = "windows"))]
#[path = "../windows_cef.rs"]
mod windows_cef;
#[cfg(target_os = "windows")]
mod windows_frame;
mod workspace;
mod workspace_move;

use tauri::{Emitter, Manager};

fn application_context() -> tauri::Context {
    tauri::generate_context!()
}

pub fn run() {
    let login_launch = autostart::LoginLaunch::new(std::env::args());
    let mut context = application_context();
    #[cfg(feature = "dev-backends")]
    development_instance::prepare(&context.config().identifier).expect("Cannot prepare development instance");
    desktop_runtime::initialize(context.config()).expect("Cannot select desktop runtime");
    #[cfg(all(feature = "hasgard-testing", debug_assertions))]
    if std::env::var_os("ALWITH_U_CEF_SHELL_TEST").is_some() {
        assert!(
            context.config().identifier.ends_with(".contract-test")
                || context.config().identifier.ends_with(".wry-test"),
            "Shell tests require an isolated application identity"
        );
        for window in &mut context.config_mut().app.windows {
            let backend = if cfg!(feature = "runtime-cef") { "CEF" } else { "Wry" };
            window.title = format!("ALwith U {backend} — Isolated native test");
            window.hidden_title = false;
            window.url = tauri::WebviewUrl::App(
                if std::env::var_os("ALWITH_U_CEF_BROWSER_TEST").is_some() {
                    "browser-fixture.html"
                } else {
                    "native-shell-test.html"
                }
                .into(),
            );
            // Browser interaction fixtures need a visible compositor for real input.
            // Hasgard positions the window on the designated test display.
            window.visible = std::env::var_os("ALWITH_U_CEF_BROWSER_TEST").is_some();
            window.width = 1000.0;
            window.min_width = Some(800.0);
        }
    }
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

    let isolated_shell = cfg!(all(feature = "hasgard-testing", debug_assertions))
        && std::env::var_os("ALWITH_U_CEF_SHELL_TEST").is_some();
    let voice_credentials = settings::VoiceCredentials::default();
    let builder = tauri::Builder::default()
        .on_web_content_process_terminate(|webview, _| {
            #[cfg(feature = "runtime-cef")]
            if webview.label().starts_with("browser-") {
                browser_chrome::guest_crashed(webview.app_handle(), webview.label());
            }
            #[cfg(not(feature = "runtime-cef"))]
            let _ = webview;
        })
        .manage(login_launch)
        .manage(enterprise::Enterprise::default())
        .register_asynchronous_uri_scheme_protocol("preview-html", html_preview::handle_protocol)
        // Official plugins sorted by name, except single-instance must precede exclusive resources.
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![autostart::ARGUMENT]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
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
        );
    // Native fixtures must not register another app with Notification Center.
    let builder = if isolated_shell { builder } else { builder.plugin(tauri_plugin_notification::init()) };
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        );

    // Non-official plugins, sorted by name after the platform window prerequisites.
    // Decoration must precede webview creation; NSPanel supplies the application window manager.
    #[cfg(target_os = "windows")]
    let builder = builder.plugin(tauri_plugin_window_decorations::init());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let builder = builder
        // U keeps its own vibemon windows; the auth plugin only refreshes tokens here.
        .plugin(alwith_auth::init(alwith_auth::Config {
            development_directory: native::development_directory(),
            vibemon: None,
        }))
        .plugin(alwith_browser::init(
            |_| runtime::sidecar_path("bun"),
            native::development_resources().map(|resources| resources.join(alwith_browser::BRIDGE_RESOURCE)),
        ))
        .plugin(alwith_chat::init_with_account(runtime::ChatRuntime, native::development_directory()))
        .plugin(alwith_computer::init(alwith_computer::Config {
            development_directory: native::development_directory(),
            application_tools: true,
            observer: Some(diagnostics::computer_observer()),
            ..Default::default()
        }))
        .plugin(alwith_desktop_shell::init_with_options(
            None,
            alwith_desktop_shell::ShellOptions::new()
                .host_native_window(cfg!(target_os = "macos") && desktop_runtime::is_cef()),
        ))
        .plugin(alwith_device::init(alwith_device::DeviceConfig {
            resources: native::development_resources(),
            development_directory: native::development_directory(),
            ..Default::default()
        }))
        .plugin(drive::plugin())
        .plugin(alwith_editor::init(alwith_editor::Config { development_directory: native::development_directory() }))
        .plugin(alwith_extension::init(alwith_extension::Config {
            root: None,
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_fs::init(alwith_fs::Config {
            coordinator: Some(std::sync::Arc::new(workspace::Coordinator)),
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_gamepad::init(alwith_gamepad::Config {
            development_directory: native::development_directory(),
            ..Default::default()
        }))
        .plugin(alwith_installed_apps::init(alwith_installed_apps::Config {
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_media::init(
            voice_credentials.clone(),
            alwith_media::Config { development_directory: native::development_directory() },
        ))
        .plugin(alwith_mobile::init(
            alwith_mobile::MobileConfig {
                host_app: alwith_mobile::HostApp::U,
                development_directory: native::development_directory(),
            },
            mobile::Host,
        ))
        .plugin(alwith_store::init())
        .plugin(alwith_terminal::init(alwith_terminal::Config {
            interactive_views: true,
            development_directory: native::development_directory(),
        }))
        .plugin(alwith_voice::init(
            voice_credentials.clone(),
            alwith_voice::Config { development_directory: native::development_directory() },
        ))
        .plugin(chat_window::init());
    // Hasgard selects the same backend as the host.
    let builder = desktop_runtime::configure(builder);
    let builder = builder
        .plugin(appearance::wallpaper::plugin())
        .manage(legacy_extensions::files::LegacyFiles::default())
        .manage(legacy_extensions::importer::LegacyImports::default())
        .manage(runtime::RuntimeState::default())
        .manage(voice_credentials)
        .manage(power::PreventSleep::default())
        .manage(device_window::DeviceWindows::default())
        .manage(extension_inbox::InboxState::default())
        .manage(vibemon::BubblePresentation::default());

    let app = builder
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "vibemon"
                && matches!(
                    event,
                    tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
                && let Err(error) = vibemon::window::follow_vibemon(window.app_handle())
            {
                log::error!("Could not reposition Vibemon bubble: {error}");
            }
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && !api.is_prevented()
            {
                // Tauri has already honored the webview's close listener. A retained panel
                // must keep its native class and AppKit observers when the listener hides it.
                panel::before_close(window.app_handle(), window.label());
            }
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
            docs_install::install(app.handle())?;
            codex_home::remove_legacy_model_cache(&codex_home::resolve(app.handle())?)?;
            #[cfg(feature = "runtime-cef")]
            if desktop_runtime::is_cef() {
                browser_ai::start(app.handle())?;
                // The isolated test application keeps no login beyond its run and stays out of the keychain.
                let identifier = &app.config().identifier;
                let logins = if identifier.ends_with(".contract-test") {
                    browser_logins::Logins::temporary()
                } else {
                    browser_logins::Logins::persistent(
                        app.path().app_data_dir()?.join("browser-logins.json"),
                        identifier,
                    )
                };
                app.manage(logins);
            }
            #[cfg(target_os = "macos")]
            app.get_webview_window("main").expect("main window exists at setup").set_effects(
                tauri::window::EffectsBuilder::new().effect(tauri::window::Effect::UnderWindowBackground).build(),
            )?;
            match app.path().app_log_dir() {
                Ok(directory) => panic_report::install(directory.join("panic.log")),
                Err(error) => log::warn!("Cannot resolve panic report directory: {error}"),
            }
            settings::initialize(app.handle())?;
            window::initialize_main_window(app.handle())?;
            window_state::install(app.handle())?;
            #[cfg(feature = "dev-backends")]
            development_instance::place(app.handle())?;
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
            let binary: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                device_window::device_window_open,
                device_window::device_window_find,
                device_window::device_window_over_main,
                device_window::device_window_selection,
                settings::settings_request,
                window_state::main_window_hidden,
                window_state::chat_window_hidden,
                generated_images::save_generated_images,
                generated_images::read_generated_image,
                desktop_runtime::runtime_capabilities,
                desktop_runtime::runtime_restart
            ];
            #[cfg(feature = "runtime-cef")]
            let browser: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
                cef_runtime::cef_open_guest,
                cef_runtime::cef_close_guest,
                cef_runtime::cef_navigate_guest,
                cef_runtime::cef_guest_history,
                cef_runtime::cef_guest_metadata,
                browser_chrome::cef_set_guest_zoom,
                browser_chrome::cef_guest_find,
                browser_extensions::cef_guest_extension_actions,
                browser_extensions::cef_guest_extension_trigger,
                browser_extensions::cef_guest_extension_activate,
                browser_extensions::cef_guest_tab_state,
                browser_extensions::cef_guest_window_focus,
                browser_chrome::cef_take_tab_requests,
                browser_extensions::cef_extension_popup_state,
                browser_chrome::cef_guest_permission,
                browser_chrome::cef_guest_page_state,
                browser_chrome::cef_guest_dialog,
                browser_chrome::cef_guest_context_menu,
                browser_chrome::cef_guest_save,
                browser_chrome::cef_guest_print,
                browser_chrome::cef_guest_inspect,
                browser_chrome::cef_guest_mute,
                browser_site::cef_guest_site_permissions,
                browser_site::cef_guest_reset_site,
                browser_site::cef_clear_browsing_data,
                browser_point::cef_guest_point,
                browser_point::cef_guest_region_screenshot,
                browser_point::cef_guest_wheel,
                browser_logins::cef_guest_login_answer,
                browser_logins::cef_logins,
                browser_logins::cef_guest_logins,
                browser_logins::cef_guest_fill_login,
                browser_logins::cef_guest_suggest_password,
                browser_logins::cef_delete_login,
                browser_logins::cef_import_logins,
                browser_chrome::cef_guest_auth,
                browser_chrome::cef_cancel_download,
                web_automation::web_automation_execute,
                web_automation::web_automation_cancel,
                web_automation::web_automation_controls,
                web_automation::web_automation_takeover,
                browser_ai::cef_browser_open_url,
                browser_ai::cef_browser_context,
                browser_ai::cef_preview_ready,
                browser_ai::cef_browser_bind,
                browser_ai::cef_browser_quick_chat,
                browser_ai::cef_browser_test_pointer,
                browser_ai::cef_browser_tabs_ready,
                browser_ai::cef_browser_revoke
            ];
            move |invoke| {
                #[cfg(feature = "runtime-cef")]
                if desktop_runtime::is_cef()
                    && matches!(
                        invoke.message.command(),
                        "cef_open_guest"
                            | "cef_close_guest"
                            | "cef_navigate_guest"
                            | "cef_guest_history"
                            | "cef_guest_metadata"
                            | "cef_set_guest_zoom"
                            | "cef_guest_find"
                            | "cef_guest_extension_actions"
                            | "cef_guest_extension_trigger"
                            | "cef_guest_extension_activate"
                            | "cef_guest_tab_state"
                            | "cef_guest_window_focus"
                            | "cef_take_tab_requests"
                            | "cef_extension_popup_state"
                            | "cef_guest_permission"
                            | "cef_guest_page_state"
                            | "cef_guest_dialog"
                            | "cef_guest_context_menu"
                            | "cef_guest_save"
                            | "cef_guest_print"
                            | "cef_guest_inspect"
                            | "cef_guest_mute"
                            | "cef_guest_site_permissions"
                            | "cef_guest_reset_site"
                            | "cef_clear_browsing_data"
                            | "cef_guest_point"
                            | "cef_guest_region_screenshot"
                            | "cef_guest_wheel"
                            | "cef_guest_login_answer"
                            | "cef_logins"
                            | "cef_guest_logins"
                            | "cef_guest_fill_login"
                            | "cef_guest_suggest_password"
                            | "cef_delete_login"
                            | "cef_import_logins"
                            | "cef_guest_auth"
                            | "cef_cancel_download"
                            | "web_automation_execute"
                            | "web_automation_cancel"
                            | "web_automation_controls"
                            | "web_automation_takeover"
                            | "cef_browser_open_url"
                            | "cef_browser_context"
                            | "cef_preview_ready"
                            | "cef_browser_bind"
                            | "cef_browser_quick_chat"
                            | "cef_browser_test_pointer"
                            | "cef_browser_tabs_ready"
                            | "cef_browser_revoke"
                    )
                {
                    return browser(invoke);
                }
                if matches!(
                    invoke.message.command(),
                    "device_window_open"
                        | "device_window_find"
                        | "device_window_over_main"
                        | "device_window_selection"
                        | "settings_request"
                        | "main_window_hidden"
                        | "chat_window_hidden"
                        | "save_generated_images"
                        | "read_generated_image"
                        | "runtime_capabilities"
                        | "runtime_restart"
                ) {
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
            } else {
                window_state::publish_current(&window);
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
            if label == "chat" {
                window_state::chat_closed(app);
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
            } else {
                #[cfg(target_os = "macos")]
                for label in ["chat", "vibemon", "bubble-menu-vibemon"] {
                    panel::before_close(app, label);
                }
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
                create_alwith::create_alwith,
                drive::drive_path_exists,
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
                chat_window::plugin::set_chat_window_backdrop,
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
        };
    }
    commands![]
}
