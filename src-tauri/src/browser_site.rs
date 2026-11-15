//! What a website keeps and may do: the permissions the user answered for it
//! and the data it stored. Chromium remembers an answer for good; this is where
//! the user sees those answers and takes them back.

use serde::Serialize;
use serde_json::json;
use tauri::Manager;
use tauri_runtime_cef::cef::sys::cef_content_setting_types_t as SettingType;
use tauri_runtime_cef::cef::sys::cef_content_setting_values_t as SettingValue;

use crate::browser_ai::{BrowserAi, GuestTarget};

/// The settings a permission prompt can leave behind, under the names the
/// interface asks for them by.
const SETTINGS: &[(&str, SettingType)] = &[
    ("Notifications", SettingType::CEF_CONTENT_SETTING_TYPE_NOTIFICATIONS),
    ("Geolocation", SettingType::CEF_CONTENT_SETTING_TYPE_GEOLOCATION),
    ("Camera", SettingType::CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_CAMERA),
    ("Microphone", SettingType::CEF_CONTENT_SETTING_TYPE_MEDIASTREAM_MIC),
    ("ClipboardRead", SettingType::CEF_CONTENT_SETTING_TYPE_CLIPBOARD_READ_WRITE),
    ("AutomaticDownloads", SettingType::CEF_CONTENT_SETTING_TYPE_AUTOMATIC_DOWNLOADS),
];

#[derive(Debug, PartialEq, Serialize)]
pub struct SitePermission {
    kind: &'static str,
    allowed: bool,
}

/// The website a guest shows, as the origin its settings and data are kept under.
fn site(webview: &tauri::Webview, label: &str) -> Result<(GuestTarget, String), String> {
    if webview.label() != "main" {
        return Err("Only the main document manages websites".into());
    }
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned().ok_or("Unknown guest")?;
    let origin = site_origin(&agent.url.lock().unwrap()).ok_or("This tab shows no website")?;
    let target = agent.view(webview.app_handle(), label).ok_or("Guest closed")?;
    Ok((target, origin))
}

/// The origin of a web address; nothing else has settings or data of its own here.
fn site_origin(url: &str) -> Option<String> {
    let url: tauri::Url = url.parse().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

/// What the user has allowed or refused this website, among what a prompt asks.
#[tauri::command]
pub async fn cef_guest_site_permissions(webview: tauri::Webview, label: String) -> Result<Vec<SitePermission>, String> {
    use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplBrowserHost, ImplRequestContext};
    let (target, origin) = site(&webview, &label)?;
    target
        .browser(move |browser| {
            let context = browser.host().and_then(|host| host.request_context()).ok_or("Guest closed")?;
            let origin = CefString::from(origin.as_str());
            Ok(SETTINGS
                .iter()
                .filter_map(|(kind, setting)| {
                    let value = context.content_setting(Some(&origin), Some(&origin), (*setting).into());
                    let allowed = if value == SettingValue::CEF_CONTENT_SETTING_VALUE_ALLOW.into() {
                        true
                    } else if value == SettingValue::CEF_CONTENT_SETTING_VALUE_BLOCK.into() {
                        false
                    } else {
                        return None;
                    };
                    Some(SitePermission { kind, allowed })
                })
                .collect())
        })
        .await
}

/// Take back every answer given to this website, so it asks again; and, when
/// `data` is set, remove what it stored (cookies, storage, caches) and load the
/// page afresh.
#[tauri::command]
pub async fn cef_guest_reset_site(webview: tauri::Webview, label: String, data: bool) -> Result<(), String> {
    use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplBrowserHost, ImplRequestContext};
    let (target, origin) = site(&webview, &label)?;
    let setting_origin = origin.clone();
    target
        .browser(move |browser| {
            let context = browser.host().and_then(|host| host.request_context()).ok_or("Guest closed")?;
            let origin = CefString::from(setting_origin.as_str());
            for (_, setting) in SETTINGS {
                context.set_content_setting(
                    Some(&origin),
                    Some(&origin),
                    (*setting).into(),
                    SettingValue::CEF_CONTENT_SETTING_VALUE_DEFAULT.into(),
                );
            }
            Ok(())
        })
        .await?;
    if !data {
        return Ok(());
    }
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    agent.call(&target, "Storage.clearDataForOrigin", json!({"origin": origin, "storageTypes": "all"})).await?;
    agent.call(&target, "Page.reload", json!({"ignoreCache": true})).await.map(|_| ())
}

/// Remove the cookies and cached files of every website. The application's own
/// document keeps neither.
#[tauri::command]
pub async fn cef_clear_browsing_data(webview: tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the main document clears browsing data".into());
    }
    webview.clear_all_browsing_data().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_website_has_settings_and_data_to_manage() {
        assert_eq!(site_origin("https://example.com/a?b#c").as_deref(), Some("https://example.com"));
        assert_eq!(site_origin("http://127.0.0.1:8080/x").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(site_origin("chrome://extensions/"), None);
        assert_eq!(site_origin("view-source:https://example.com/"), None);
        assert_eq!(site_origin("about:blank"), None);
        assert_eq!(site_origin(""), None);
    }
}
