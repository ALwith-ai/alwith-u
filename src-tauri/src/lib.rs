mod auth;
mod installed_apps;
mod menu;
mod native;
mod runtime;
mod updater;
mod window;

use tauri::{Emitter, Manager};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
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
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(runtime::RuntimeState::default());

    #[cfg(feature = "hasgard-testing")]
    let builder = builder.plugin(tauri_plugin_hasgard::init());

    builder
        .on_menu_event(|app, event| {
            let Some(event_name) = menu::event_name(event.id().0.as_str()) else {
                return;
            };
            if let Some(focused) = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
            {
                let _ = app.emit_to(focused.label(), event_name, ());
            }
        })
        .setup(|app| {
            app.manage(native::Native::load(app.handle())?);
            log::info!("ALwith ü {} starting", env!("CARGO_PKG_VERSION"));
            // The window is transparent; macOS paints the sidebar glass behind it (ALwith
            // Desktop's native_window_effects). Panels that must stay opaque paint their own
            // background in CSS.
            #[cfg(target_os = "macos")]
            {
                use tauri::window::{Effect, EffectsBuilder};
                app.get_webview_window("main")
                    .expect("main window exists at setup")
                    .set_effects(
                        EffectsBuilder::new()
                            .effect(Effect::UnderWindowBackground)
                            .build(),
                    )?;
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
        .invoke_handler(tauri::generate_handler![
            auth::refresh_tokens,
            runtime::runtime_start,
            runtime::runtime_send,
            updater::commands::updater_get_state,
            updater::commands::updater_install_and_relaunch,
            window::attach_window_to_main,
            installed_apps::read_apps_info,
            installed_apps::open_path_in_app
        ])
        .build(tauri::generate_context!())
        .expect("error while building ALwith U")
        .run(|app, event| match event {
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                app.state::<runtime::RuntimeState>().shutdown();
            }
            // Quit paths that never destroy the window (Cmd+Q from the menu, app.exit) still
            // have to take alwith-runtime with them; the kill is synchronous so the tokio runtime
            // cannot tear down first.
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                app.state::<runtime::RuntimeState>().shutdown();
            }
            _ => {}
        });
}
