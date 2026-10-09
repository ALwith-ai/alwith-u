#[cfg(test)]
mod codex_launcher;

mod appearance;
mod auth;
mod bundled_extensions;
mod chat_files;
mod chat_window;
mod draft_directory;
mod extension_capabilities;
#[cfg(target_os = "macos")]
mod extension_cli;
#[cfg(target_os = "macos")]
mod extension_control;
mod extension_wire;
mod installed_apps;
mod legacy_extensions;
mod menu;
mod native;
mod providers;
mod runtime;
mod updater;
mod window;

use tauri::{Emitter, Manager};

fn application_context() -> tauri::Context {
    tauri::generate_context!()
}

fn extension_cli_args(mut args: impl Iterator<Item = std::ffi::OsString>) -> Result<Option<Vec<String>>, String> {
    if args.next().is_none_or(|arg| arg != "extension") {
        return Ok(None);
    }
    let mut parsed = vec!["extension".into()];
    for arg in args {
        parsed.push(arg.into_string().map_err(|_| "Extension CLI arguments must be UTF-8".to_string())?);
    }
    Ok(Some(parsed))
}

/// Dispatch script commands before Tauri starts or joins the GUI instance.
pub fn run_extension_cli() -> Option<i32> {
    let args = match extension_cli_args(std::env::args_os().skip(1)) {
        Ok(Some(args)) => args,
        Ok(None) => return None,
        Err(error) => {
            eprintln!("{error}");
            return Some(2);
        }
    };
    #[cfg(target_os = "macos")]
    {
        let context = application_context();
        Some(extension_cli::run(&args, &context.config().identifier))
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("Extension CLI installation is currently supported on macOS only");
        Some(2)
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_window_state::Builder::new().with_denylist(&["chat", "settings"]).build())
        .manage(legacy_extensions::files::LegacyFiles::default())
        .manage(legacy_extensions::importer::LegacyImports::default())
        .manage(runtime::RuntimeState::default());

    #[cfg(feature = "hasgard-testing")]
    let builder = builder.plugin(tauri_plugin_hasgard::init());

    builder
        .on_menu_event(|app, event| {
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
            #[cfg(target_os = "macos")]
            {
                let control = extension_control::ExtensionControl::start(app.handle()).unwrap_or_else(|error| {
                    log::error!("Extension CLI control is unavailable: {error}");
                    extension_control::ExtensionControl::failed(error)
                });
                app.manage(control);
            }
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
            // Runtime belongs to the application. All quit paths converge here; shutdown is
            // synchronous so the async runtime cannot tear down before its children leave.
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                #[cfg(target_os = "macos")]
                app.state::<extension_control::ExtensionControl>().stop();
                app.state::<runtime::RuntimeState>().shutdown();
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
                draft_directory::draft_directory,
                chat_files::chat_save_file,
                chat_files::chat_read_image,
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
                legacy_extensions::files::legacy_directories,
                legacy_extensions::files::legacy_pick_directory,
                appearance::wallpaper::wallpaper_list,
                appearance::wallpaper::wallpaper_import,
                appearance::wallpaper::wallpaper_remove,
                auth::refresh_tokens,
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
            .event::<menu::FindInChat>()
            .event::<menu::CommandPalette>()
            .event::<menu::OpenHotkeys>()
            .event::<menu::ZoomIn>()
            .event::<menu::ZoomOut>()
            .event::<menu::ActualSize>()
        };
    }
    #[cfg(target_os = "macos")]
    let bindings = commands![
        extension_control::extension_control_next,
        extension_control::extension_control_complete,
        extension_control::extension_control_unavailable,
        extension_control::extension_control_status,
    ];
    #[cfg(not(target_os = "macos"))]
    let bindings = commands![];
    bindings
}
