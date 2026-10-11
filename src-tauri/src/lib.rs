#[cfg(test)]
mod codex_launcher;

mod appearance;
mod auth;
mod bundled_extensions;
mod chat_files;
mod chat_window;
mod draft_directory;
mod drive;
mod extension_capabilities;
mod extension_inbox;
mod extension_wire;
mod html_preview;
mod installed_apps;
mod legacy_extensions;
mod menu;
mod native;
mod providers;
mod runtime;
mod updater;
mod vibemon;
mod window;
mod workspace;
mod workspace_move;

use tauri::{Emitter, Manager};

fn application_context() -> tauri::Context {
    tauri::generate_context!()
}

pub fn run() {
    // HTTP and WebSocket dependencies enable both providers; select one before TLS clients start.
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("install process-wide rustls crypto provider");

    let builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("preview-html", html_preview::handle_protocol)
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        // Second launch: focus the running instance instead of starting a second alwith-runtime
        // against the same ~/.codex.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            log::info!("second instance argv={argv:?} cwd={cwd:?}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    let builder = builder
        .plugin(chat_window::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(alwith_extension::plugin::init())
        .plugin(appearance::wallpaper::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        // Chat is created hidden before converting it to NSPanel. Restoring visibility here
        // would focus an unprepared NSWindow and break AppKit's keyboard/KVO lifecycle.
        // Settings has a fixed logical size; cached physical sizes must not override it.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["chat", "settings", "vibemon", "bubble-menu-vibemon"])
                .build(),
        )
        .manage(legacy_extensions::files::LegacyFiles::default())
        .manage(legacy_extensions::importer::LegacyImports::default())
        .manage(runtime::RuntimeState::default())
        .manage(extension_inbox::InboxState::default());

    #[cfg(feature = "hasgard-testing")]
    let builder = builder.plugin(tauri_plugin_hasgard::init());

    builder
        .on_menu_event(|app, event| {
            if event.id().0 == menu::QUIT_ID {
                app.exit(0);
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
            app.manage(native::Native::load(app.handle())?);
            app.manage(providers::Providers::load(app.handle())?);
            drive::initialize(app.handle())?;
            log::info!("ALwith U {} starting", env!("CARGO_PKG_VERSION"));
            // The window is transparent; macOS paints the sidebar glass behind it (ALwith
            // Desktop's native_window_effects). Panels that must stay opaque paint their own
            // background in CSS.
            #[cfg(target_os = "macos")]
            {
                use tauri::window::{Effect, EffectsBuilder};
                app.get_webview_window("main")
                    .expect("main window exists at setup")
                    .set_effects(EffectsBuilder::new().effect(Effect::UnderWindowBackground).build())?;
            }
            // Windows draws no app-level menu (it would surface on every window); macOS wants
            // one NSApp menu and Linux a per-window one. Built here, not in `Builder::menu`,
            // because the locale lookup needs the path resolver, which exists only after build.
            #[cfg(not(target_os = "windows"))]
            app.set_menu(menu::build_app_menu(app.handle())?)?;
            updater::init(app);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            log::info!("page {:?} {}", payload.event(), payload.url());
            let _ = webview;
        })
        .invoke_handler(bindings().invoke_handler())
        .build(application_context())
        .expect("error while building ALwith U")
        .run(|app, event| match event {
            // U's main window owns the application lifetime. A hidden settings window must
            // neither keep a headless U running nor stop chats when it is destroyed.
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => {
                app.exit(0);
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                let closing =
                    app.state::<runtime::RuntimeState>().is_closing() || app.state::<drive::DriveState>().is_closing();
                if (!closing && workspace::prevent_exit(app))
                    || drive::prevent_exit(app, code)
                    || runtime::prevent_exit(app, code)
                {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
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
                extension_inbox::extension_inbox_scan,
                extension_inbox::extension_inbox_prepare,
                extension_inbox::extension_inbox_complete,
                extension_inbox::extension_inbox_failed,
                draft_directory::draft_directory,
                drive::drive_request,
                drive::drive_path_exists,
                chat_files::chat_save_file,
                chat_files::chat_read_image,
                workspace::workspace_open,
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
                auth::refresh_tokens,
                vibemon::vibemon_window,
                vibemon::vibemon_resource,
                vibemon::vibemon_download,
                vibemon::vibemon_claim,
                chat_window::plugin::present_chat_window,
                chat_window::plugin::resize_chat_window,
                runtime::runtime_start,
                runtime::runtime_send,
                runtime::codex_version,
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
                installed_apps::open_path_in_app
            ]
            .event::<runtime::RuntimeLines>()
            .event::<runtime::RuntimeExit>()
            .event::<providers::Snapshot>()
            .event::<updater::state::State>()
            .event::<menu::OpenSettings>()
            .event::<menu::NewChat>()
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
