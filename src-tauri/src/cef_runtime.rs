//! CEF configuration shared by the desktop entry point and native UI tests.

/// The Chromium locale for a language tag: the interface language the user chose, else the
/// system's. Chromium names a locale by language and region and knows no script subtag, and it
/// ships a regional variant only for some languages; a bare language it has no pack for by that
/// name takes the variant most of its readers use.
pub fn browser_locale(saved: Option<&str>, system: Option<&str>) -> String {
    let tag = saved.or(system).unwrap_or("en-US").replace('_', "-");
    let mut parts = tag.split('-');
    let language = parts.next().unwrap_or_default().to_ascii_lowercase();
    let rest: Vec<&str> = parts.collect();
    let script = rest.iter().find(|part| part.len() == 4).map(|part| part.to_ascii_lowercase());
    let region = rest.iter().find(|part| part.len() == 2).map(|part| part.to_ascii_uppercase());
    match (language.as_str(), script.as_deref(), region.as_deref()) {
        ("zh", Some("hant"), _) | ("zh", None, Some("TW" | "HK" | "MO")) => "zh-TW".into(),
        ("zh", ..) => "zh-CN".into(),
        ("en", _, Some("GB" | "AU" | "NZ" | "IE" | "ZA" | "IN")) => "en-GB".into(),
        ("en", ..) | ("", ..) => "en-US".into(),
        ("pt", _, Some("PT")) => "pt-PT".into(),
        ("pt", ..) => "pt-BR".into(),
        ("es", _, Some(region)) if region != "ES" => "es-419".into(),
        _ => language,
    }
}

pub fn create() -> tauri_runtime_cef::Cef {
    let runtime = tauri_runtime_cef::Cef::default()
        // Chromium's own pages and controls, and the languages a website is asked for, follow
        // the application's language. The whole set of locale packs is staged with the framework.
        .locale(crate::desktop_runtime::browser_locale())
        // The alpha bundler does not yet package the Aperitif helper application.
        .disable_features(["AperitifHelpers"])
        // FedCM's account chooser belongs to a Chrome browser window, which a tab here does not
        // have: Chromium 158 crashes the browser process when a website asks for it. With the
        // feature off a website finds no FedCM and uses its other sign-in flow.
        .disable_features(["FedCm"]);

    // Ad-hoc development builds must not alternate cookie keys depending on
    // whether they use Vite or embedded assets. Production keeps the OS keychain.
    #[cfg(all(debug_assertions, target_os = "macos"))]
    let runtime = runtime
        .root_cache_path(crate::desktop_runtime::development_cache())
        .secret_storage(tauri_runtime_cef::SecretStorage::Mock);

    // Windows uses DPAPI in both development entry points. Keep the default
    // cache location and encryption mode stable when switching to bundled assets.
    #[cfg(target_os = "windows")]
    let runtime = runtime.secret_storage(tauri_runtime_cef::SecretStorage::System);

    #[cfg(feature = "experimental-cef")]
    let runtime = runtime
        .cef_api_version(tauri_runtime_cef::cef::sys::CEF_API_VERSION_EXPERIMENTAL)
        .command_line_arg("--enable-cef-surface-embed", None::<String>)
        .command_line_arg("--enable-cef-windowed-transparency", None::<String>)
        .enable_features(["SurfaceEmbed"])
        // Browser extensions serve the websites in tabs. The application's own
        // documents are closed to them: no script, no host access, no sight of
        // their requests.
        .command_line_arg("--cef-extension-blocked-hosts", Some(crate::desktop_runtime::application_hosts()))
        // A page an extension opens is a tab like any other, never a Chromium window.
        .on_tab_request(crate::browser_chrome::tab_requested);

    #[cfg(all(feature = "hasgard-testing", debug_assertions))]
    let runtime = if std::env::var_os("ALWITH_U_CEF_SHELL_TEST").is_some()
        && let Some(profile) = std::env::var_os("ALWITH_U_CEF_TEST_PROFILE")
    {
        assert!(std::path::Path::new(&profile).is_absolute(), "CEF test profile must be absolute");
        let runtime = runtime.root_cache_path(profile).secret_storage(tauri_runtime_cef::SecretStorage::Mock);
        // The extension contract loads its own unpacked extension; nothing else can.
        match std::env::var("ALWITH_U_CEF_TEST_EXTENSION") {
            Ok(extension) => runtime
                .disable_features(["DisableLoadExtensionCommandLineSwitch"])
                .command_line_arg("--load-extension", Some(extension)),
            Err(_) => runtime,
        }
    } else {
        runtime
    };

    runtime
}

#[derive(serde::Serialize)]
pub struct Guest {
    label: String,
    token: String,
}

/// The session history a restored or reopened tab starts with.
#[derive(serde::Deserialize)]
pub struct SavedHistory {
    entries: Vec<SavedPage>,
    shown: usize,
}

#[derive(serde::Deserialize)]
struct SavedPage {
    url: String,
    title: String,
    /// The state the page was left in, as `cef_guest_page_state` gave it.
    #[serde(default)]
    state: Option<String>,
}

/// Creates a live guest owned by the main application document.
#[tauri::command]
pub async fn cef_open_guest(
    webview: tauri::Webview, url: String, request_id: Option<String>, private: Option<bool>,
    history: Option<SavedHistory>,
) -> Result<Guest, String> {
    #[cfg(not(feature = "experimental-cef"))]
    {
        let _ = (webview, url, request_id, private, history);
        Err("Surface embedding requires experimental-cef".into())
    }
    #[cfg(feature = "experimental-cef")]
    {
        use tauri::{Emitter, Manager};
        use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost};
        use tauri_runtime_cef::{WebviewBuilderCefExt, WebviewCefExt};
        if webview.label() != "main" {
            return Err("Only the main document can create browser guests".into());
        }
        let url: tauri::Url = url.parse().map_err(|error| format!("Invalid URL: {error}"))?;
        // An AI conversation's tab is never the extensions page.
        let extensions = request_id.is_none() && crate::browser_ai::user_page(&url);
        if !matches!(url.scheme(), "https" | "http") && url.as_str() != "about:blank" && !extensions {
            return Err("Browser guests require HTTP(S)".into());
        }
        // A private tab is the user's: a conversation opens none.
        let private = private.unwrap_or(false);
        if private && request_id.is_some() {
            return Err("A conversation cannot open a private tab".into());
        }
        // Only the user's own ordinary tab resumes a history, and only one of websites
        // that shows the address asked for.
        let history = match history {
            Some(history) => {
                if private || request_id.is_some() {
                    return Err("Only an ordinary tab resumes a session history".into());
                }
                let websites = history.entries.iter().all(|page| {
                    page.url.parse::<tauri::Url>().is_ok_and(|address| matches!(address.scheme(), "https" | "http"))
                });
                if !websites || history.entries.get(history.shown).map(|page| page.url.as_str()) != Some(url.as_str()) {
                    return Err("Invalid session history".into());
                }
                Some(tauri_runtime_cef::SessionHistory {
                    entries: history
                        .entries
                        .into_iter()
                        .map(|page| tauri_runtime_cef::SessionEntry {
                            url: page.url,
                            title: page.title,
                            // The browser takes only a state of the entry's own address.
                            state: page.state.filter(|state| state.len() <= crate::browser_chrome::PAGE_STATE_LIMIT),
                        })
                        .collect(),
                    shown: history.shown,
                })
            }
            None => None,
        };
        let label = format!("browser-{}", uuid::Uuid::new_v4());
        webview.state::<crate::browser_ai::BrowserAi>().bind_preview(&label, request_id.as_deref())?;
        let popup_app = webview.app_handle().clone();
        let popup_root = label.clone();
        let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(url.clone()))
            .surface_embed_parent("main")
            // Its own profile, in memory: cookies and storage end with the tab.
            .incognito(private)
            .browser_content()
            .on_surface_popup(move |event| surface_popup(&popup_app, &popup_root, event))
            .on_browser_status({
                let (app, label) = (webview.app_handle().clone(), label.clone());
                move |status| crate::browser_chrome::guest_status(&app, &label, status)
            })
            .browser_shortcuts(crate::browser_chrome::shortcut_claim)
            // An ordinary website asks the user; nothing is granted silently.
            .prompt_permissions()
            // A guest has no native window for CEF's own dialog; the tab shows it.
            .prompt_dialogs()
            .on_download(|view, event| crate::browser_chrome::guest_download(&view, event))
            .on_document_title_changed(|view, title| {
                // Kept for the snapshot: a fast page is titled before its tab has subscribed,
                // and a page from disk before its guest is even registered.
                let state = view.state::<crate::browser_ai::BrowserAi>();
                match state.guests.lock().unwrap().get(view.label()) {
                    Some(agent) => *agent.title.lock().unwrap() = title.clone(),
                    None => {
                        state.early_titles.lock().unwrap().insert(view.label().to_owned(), title.clone());
                    }
                }
                let _ = view.emit_to(
                    "main",
                    "browser-tab-updated",
                    serde_json::json!({"label":view.label(),"title":title}),
                );
            })
            .on_page_load(|view, payload| {
                crate::browser_chrome::report_history(
                    view.app_handle(),
                    view.label(),
                    &crate::browser_ai::GuestTarget::View(view.clone()),
                );
                let reported = payload.url().to_string();
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                    crate::browser_chrome::guest_document(view.app_handle(), view.label(), &reported);
                }
                let url = match view.state::<crate::browser_ai::BrowserAi>().guests.lock().unwrap().get(view.label()) {
                    Some(agent) => crate::browser_ai::shown_address(&agent.url.lock().unwrap(), &reported),
                    None => reported,
                };
                let _ =
                    view.emit_to("main", "browser-tab-updated", serde_json::json!({"label":view.label(),"url":url}));
            });
        let builder = match history {
            Some(history) => builder.session_history(history),
            None => builder,
        };
        let guest = webview.window().add_child(builder).map_err(|error| error.to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        if let Err(error) = guest.with_cef_webview(move |native| {
            let token = native
                .browser()
                .host()
                .map(|host| tauri_runtime_cef::cef::CefString::from(&host.surface_embed_token()).to_string());
            let _ = sender.send(token);
        }) {
            let _ = guest.close();
            return Err(error.to_string());
        }
        match tokio::time::timeout(std::time::Duration::from_secs(10), receiver).await {
            Ok(Ok(Some(token))) if !token.is_empty() => {
                match crate::browser_ai::GuestAgent::attach(&guest, url.as_str()) {
                    Ok(agent) => {
                        agent.private.store(private, std::sync::atomic::Ordering::Relaxed);
                        let state = webview.state::<crate::browser_ai::BrowserAi>();
                        let mut guests = state.guests.lock().expect("browser guests");
                        // Under the same lock the title callback takes, so none falls between.
                        if let Some(title) = state.early_titles.lock().unwrap().remove(&label) {
                            *agent.title.lock().unwrap() = title;
                        }
                        guests.insert(label.clone(), agent.clone());
                        drop(guests);
                        // A tab of the user's remembers their logins; a conversation's or a private one does not.
                        // Wherever it starts: the script itself acts only in a website's page.
                        if request_id.is_none() && !private {
                            let (app, label) = (webview.app_handle().clone(), label.clone());
                            tauri::async_runtime::spawn(async move {
                                if let Some(target) = agent.view(&app, &label)
                                    && let Err(error) = crate::browser_logins::watch(&agent, &target).await
                                {
                                    log::warn!("Cannot watch the logins of {label}: {error}");
                                }
                            });
                        }
                        Ok(Guest { label, token })
                    }
                    Err(error) => {
                        let _ = guest.close();
                        Err(error)
                    }
                }
            }
            _ => {
                let _ = guest.close();
                Err("Browser guest did not provide an embedding token".into())
            }
        }
    }
}

#[tauri::command]
pub async fn cef_close_guest(webview: tauri::Webview, label: String) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    if webview.label() != "main" || !label.starts_with("browser-") {
        return Err("Only the main document can close browser guests".into());
    }
    let agent = webview.state::<crate::browser_ai::BrowserAi>().guests.lock().unwrap().get(&label).cloned();
    if let Some(agent) = agent
        && let Some(popup) = &agent.popup
    {
        // The native close event removes the tab; an already closed popup is done.
        let _ = crate::browser_ai::GuestTarget::close_popup(popup).await;
        return Ok(());
    }
    if let Some(guest) = webview.get_webview(&label) {
        if guest.window().label() != webview.window().label() {
            return Err("Browser guest belongs to another window".into());
        }
        guest.close().map_err(|error| error.to_string())?;
        webview.state::<crate::browser_ai::BrowserAi>().owners.lock().unwrap().remove(&label);
        webview.state::<crate::browser_ai::BrowserAi>().controls.lock().unwrap().remove(&label);
        let _ = webview.emit_to("main", "browser-tab-closed", serde_json::json!({"label":label}));
        if let Some(agent) =
            webview.state::<crate::browser_ai::BrowserAi>().guests.lock().expect("browser guests").remove(&label)
        {
            agent.cancel();
        }
    }
    Ok(())
}

/// Address-bar navigation uses the same live guest, preserving its profile and surface.
#[tauri::command]
pub async fn cef_navigate_guest(webview: tauri::Webview, label: String, url: String) -> Result<(), String> {
    use tauri::Manager;
    if webview.label() != "main" {
        return Err("Only the main document can navigate guests".into());
    }
    let url: tauri::Url = url.parse().map_err(|_| "Invalid URL")?;
    let state = webview.state::<crate::browser_ai::BrowserAi>();
    // The user manages extensions in a tab of their own, never in one an AI conversation holds.
    let extensions = crate::browser_ai::user_page(&url) && !state.owners.lock().unwrap().contains_key(&label);
    if !matches!(url.scheme(), "http" | "https") && !extensions {
        return Err("Navigation requires HTTP(S)".into());
    }
    let agent = state.guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    let guest = agent.view(webview.app_handle(), &label).ok_or("Guest closed")?;
    crate::browser_chrome::release_dialog(webview.app_handle(), &label, &guest).await;
    if url.scheme() == "view-source" {
        // Its browser will report the page's own address; the tab is told now what it shows.
        *agent.url.lock().unwrap() = url.to_string();
    }
    crate::browser_chrome::load(&guest, url.into()).await
}

/// User-facing navigation controls share the guest's existing history and profile.
#[tauri::command]
pub async fn cef_guest_history(webview: tauri::Webview, label: String, action: String) -> Result<(), String> {
    use tauri::Manager;
    if webview.label() != "main" {
        return Err("Only the main document can navigate tabs".into());
    }
    let agent = webview
        .state::<crate::browser_ai::BrowserAi>()
        .guests
        .lock()
        .unwrap()
        .get(&label)
        .cloned()
        .ok_or("Unknown guest")?;
    let view = agent.view(webview.app_handle(), &label).ok_or("Guest closed")?;
    crate::browser_chrome::release_dialog(webview.app_handle(), &label, &view).await;
    crate::browser_chrome::navigate(&view, &action).await
}

#[cfg(feature = "experimental-cef")]
fn surface_popup(app: &tauri::AppHandle, root: &str, event: tauri_runtime_cef::SurfacePopupEvent) {
    use crate::browser_ai::{BrowserAi, GuestAgent};
    use tauri::{Emitter, Manager};
    use tauri_runtime_cef::SurfacePopupEvent;
    let state = app.state::<BrowserAi>();
    match event {
        SurfacePopupEvent::Created { browser_id, opener_id, token, url, popup, .. } => {
            let label = format!("browser-popup-{browser_id}");
            let opener = format!("browser-popup-{opener_id}");
            let session = {
                let mut owners = state.owners.lock().unwrap();
                let session = owners.get(&opener).or_else(|| owners.get(root)).cloned();
                if let Some(session) = &session {
                    owners.insert(label.clone(), session.clone());
                }
                session
            };
            let agent = GuestAgent::popup(popup, url.clone());
            // A tab a page opened is its opener's kind: private if that was, a conversation's if that was.
            let private = [opener.as_str(), root].into_iter().any(|parent| {
                let guests = state.guests.lock().unwrap();
                guests.get(parent).is_some_and(|parent| parent.private.load(std::sync::atomic::Ordering::Relaxed))
            });
            agent.private.store(private, std::sync::atomic::Ordering::Relaxed);
            state.guests.lock().unwrap().insert(label.clone(), agent.clone());
            // One of the user's own remembers their logins like any other tab of theirs.
            if session.is_none() && !private {
                let (app, label) = (app.clone(), label.clone());
                tauri::async_runtime::spawn(async move {
                    if let Some(target) = agent.view(&app, &label)
                        && let Err(error) = crate::browser_logins::watch(&agent, &target).await
                    {
                        log::warn!("Cannot watch the logins of {label}: {error}");
                    }
                });
            }
            let _ = app.emit_to(
                "main",
                "browser-popup-created",
                serde_json::json!({"label":label,"token":token,"url":url,"sessionId":session}),
            );
        }
        SurfacePopupEvent::Protocol { browser_id, message } => {
            let label = format!("browser-popup-{browser_id}");
            let agent = state.guests.lock().unwrap().get(&label).cloned();
            if let Some(agent) = agent {
                if let tauri_runtime_cef::DevToolsProtocol::Event { method, params } = &message
                    && method == "Page.frameNavigated"
                    && let Ok(value) = serde_json::from_slice::<serde_json::Value>(params)
                    && value["frame"]["parentId"].is_null()
                {
                    let _ = app.emit_to(
                        "main",
                        "browser-tab-updated",
                        serde_json::json!({"label":label,"url":value["frame"]["url"]}),
                    );
                }
                if !crate::browser_logins::intercept(app, &label, &agent, &message) {
                    agent.receive(message);
                }
            }
        }
        SurfacePopupEvent::Title { browser_id, title } => {
            if let Some(agent) = state.guests.lock().unwrap().get(&format!("browser-popup-{browser_id}")) {
                *agent.title.lock().unwrap() = title.clone();
            }
            let _ = app.emit_to(
                "main",
                "browser-tab-updated",
                serde_json::json!({"label":format!("browser-popup-{browser_id}"),"title":title}),
            );
        }
        SurfacePopupEvent::Status { browser_id, status } => {
            crate::browser_chrome::guest_status(app, &format!("browser-popup-{browser_id}"), status);
        }
        SurfacePopupEvent::Closed { browser_id } => {
            let label = format!("browser-popup-{browser_id}");
            state.owners.lock().unwrap().remove(&label);
            state.controls.lock().unwrap().remove(&label);
            if let Some(agent) = state.guests.lock().unwrap().remove(&label) {
                agent.cancel();
            }
            let _ = app.emit_to("main", "browser-tab-closed", serde_json::json!({"label":label}));
        }
        _ => {}
    }
}

/// Snapshot after subscribing, so early popup navigation/title events cannot be lost.
#[tauri::command]
pub fn cef_guest_metadata(webview: tauri::Webview, label: String) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    if webview.label() != "main" {
        return Err("Only the main document can inspect tabs".into());
    }
    let agent = webview
        .state::<crate::browser_ai::BrowserAi>()
        .guests
        .lock()
        .unwrap()
        .get(&label)
        .cloned()
        .ok_or("Guest closed")?;
    let url = agent.url.lock().unwrap().clone();
    let title = agent.title.lock().unwrap().clone();
    let mut metadata = serde_json::to_value(&*agent.chrome.lock().unwrap()).map_err(|error| error.to_string())?;
    metadata["label"] = label.into();
    metadata["url"] = url.into();
    metadata["title"] = title.into();
    Ok(metadata)
}

#[cfg(test)]
#[path = "__tests__/browser_locale.rs"]
mod browser_locale_tests;
