//! Toolbar buttons of browser extensions, as they stand for the tab that shows a page.
//!
//! The application draws its own toolbar, so Chrome's has no place to put an
//! extension's button. The modified CEF answers two methods on the browser that
//! shows a page (`CefExtensions.getActions`, `.trigger`, `.activate`); they are
//! sent like DevTools methods but never reach the page's agent, and the
//! protocol filter for AI conversations does not admit their domain.

use serde::Serialize;
use serde_json::{Value, json};
use tauri::Manager;

use crate::browser_ai::BrowserAi;

/// An icon larger than this is not a toolbar icon.
const MAX_ICON_BYTES: u64 = 256 * 1024;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionAction {
    id: String,
    name: String,
    /// The tooltip; an extension may set it per tab.
    title: String,
    enabled: bool,
    badge: String,
    badge_color: String,
    /// Pressing the button shows a popup instead of telling the extension.
    popup: bool,
    /// A data URL: the application document never loads an extension's files itself.
    icon: Option<String>,
}

fn media_type(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// One button from the browser's description of it. `read` loads an icon file
/// the extension ships, given the extension's directory; an icon the extension
/// drew arrives as a data URL already.
fn describe(
    value: &Value, read: impl Fn(&std::path::Path, &std::path::Path) -> Option<Vec<u8>>,
) -> Option<ExtensionAction> {
    use base64::Engine;
    let text = |field: &str| value[field].as_str().map(str::to_owned);
    let icon = text("icon").filter(|icon| icon.starts_with("data:image/")).or_else(|| {
        let path = text("iconPath").filter(|path| !path.is_empty())?;
        let path = std::path::Path::new(&path);
        let media = media_type(path)?;
        let root = text("root")?;
        let bytes = read(path, std::path::Path::new(&root))?;
        Some(format!("data:{media};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    });
    Some(ExtensionAction {
        id: text("id")?,
        name: text("name")?,
        title: text("title").unwrap_or_default(),
        enabled: value["enabled"].as_bool()?,
        badge: text("badge").unwrap_or_default(),
        badge_color: text("badgeColor").unwrap_or_default(),
        popup: value["popup"].as_bool()?,
        icon,
    })
}

async fn call(webview: &tauri::Webview, label: &str, method: &str, params: Value) -> Result<Value, String> {
    if webview.label() != "main" {
        return Err("Only the main document can reach browser extensions".into());
    }
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned().ok_or("Unknown guest")?;
    let view = agent.view(webview.app_handle(), label).ok_or("Guest closed")?;
    agent.call(&view, method, params).await
}

/// The extension buttons for this tab: icon, tooltip, badge and whether each is enabled here.
#[tauri::command]
pub async fn cef_guest_extension_actions(
    webview: tauri::Webview, label: String,
) -> Result<Vec<ExtensionAction>, String> {
    let reply = call(&webview, &label, "CefExtensions.getActions", json!({})).await?;
    let actions = reply["actions"].as_array().ok_or("The browser did not list extension actions")?;
    Ok(actions.iter().filter_map(|action| describe(action, read_icon)).collect())
}

/// An icon file of bounded size that really lies inside the extension's own
/// directory, whatever its manifest names and wherever a link in it points.
fn read_icon(path: &std::path::Path, root: &std::path::Path) -> Option<Vec<u8>> {
    let (path, root) = (path.canonicalize().ok()?, root.canonicalize().ok()?);
    if !path.starts_with(&root) || std::fs::metadata(&path).ok()?.len() > MAX_ICON_BYTES {
        return None;
    }
    std::fs::read(path).ok()
}

/// This is the tab the user is looking at: to extensions, the active tab of
/// the current window. The browser cannot tell, since the application shows
/// and hides its tabs itself.
#[tauri::command]
pub async fn cef_guest_extension_activate(webview: tauri::Webview, label: String) -> Result<(), String> {
    call(&webview, &label, "CefExtensions.activate", json!({})).await.map(|_| ())
}

/// Say where a tab is in the user's tab strip and whether it is pinned there:
/// only the application knows, and extensions ask. `moved` marks the tab that
/// was moved, as against one that made room for it.
#[tauri::command]
pub async fn cef_guest_tab_state(
    webview: tauri::Webview, label: String, index: u32, pinned: bool, moved: bool,
) -> Result<(), String> {
    call(&webview, &label, "CefExtensions.setTabState", json!({"index": index, "pinned": pinned, "moved": moved}))
        .await
        .map(|_| ())
}

/// Say that the application's window came to the front or left it: only the
/// application knows, and extensions are told as `windows.onFocusChanged`. Any
/// tab of the profile carries the word.
#[tauri::command]
pub async fn cef_guest_window_focus(webview: tauri::Webview, label: String, focused: bool) -> Result<(), String> {
    call(&webview, &label, "CefExtensions.setWindowFocused", json!({"focused": focused})).await.map(|_| ())
}

/// The user pressed an extension's button on this tab. Returns the address of
/// the popup to show, or an empty string when the extension was told instead.
#[tauri::command]
pub async fn cef_guest_extension_trigger(webview: tauri::Webview, label: String, id: String) -> Result<String, String> {
    let reply = call(&webview, &label, "CefExtensions.trigger", json!({"id": id})).await?;
    Ok(reply["popup"].as_str().unwrap_or_default().to_owned())
}

/// Chrome's own bounds for an extension popup.
const POPUP_MIN: f64 = 25.0;
const POPUP_MAX: (f64, f64) = (800.0, 600.0);

/// What a popup's document says of itself: its content's size, and whether it
/// asked to be closed.
///
/// A browser sizes a popup's window to its content. Here the surface comes
/// first, and a document is never smaller than what shows it, so the root is
/// made to wrap its content and is measured instead.
///
/// A page may close only a window a script opened, so `window.close()` would do
/// nothing in a popup the application hosts; it is replaced by a request the
/// application honours, as a browser does.
const POPUP_STATE: &str = "(() => {
  if (!window.__popup) {
    window.__popup = { closing: false }
    window.close = () => { window.__popup.closing = true }
    const style = document.createElement('style')
    style.textContent = 'html { width: max-content !important; height: max-content !important }'
    document.documentElement.append(style)
  }
  const box = document.documentElement.getBoundingClientRect()
  return [Math.ceil(box.width), Math.ceil(box.height), window.__popup.closing]
})()";

#[derive(Debug, PartialEq, Serialize)]
pub struct PopupState {
    width: f64,
    height: f64,
    /// The popup called `window.close()`.
    closing: bool,
}

/// A popup is as large as its content, within Chrome's bounds.
fn popup_state(reported: &Value) -> Option<PopupState> {
    let side = |index: usize, max: f64| Some(reported.get(index)?.as_f64()?.clamp(POPUP_MIN, max));
    Some(PopupState {
        width: side(0, POPUP_MAX.0)?,
        height: side(1, POPUP_MAX.1)?,
        closing: reported.get(2)?.as_bool()?,
    })
}

/// The size an extension's popup wants and whether it asked to close, read from its document.
#[tauri::command]
pub async fn cef_extension_popup_state(webview: tauri::Webview, label: String) -> Result<PopupState, String> {
    let reply = call(
        &webview,
        &label,
        "Runtime.evaluate",
        json!({
            "expression": POPUP_STATE,
            "returnByValue": true
        }),
    )
    .await?;
    popup_state(&reply["result"]["value"]).ok_or_else(|| "The popup has no document yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_button_carries_its_icon_as_data_and_its_state_for_the_tab() {
        let shipped = json!({
            "id": "abcdefghijklmnopabcdefghijklmnop", "name": "Blocker", "title": "Blocker (3)", "enabled": true,
            "badge": "3", "badgeColor": "#cc0000", "popup": true, "iconPath": "/extensions/blocker/icon32.png",
            "root": "/extensions/blocker"
        });
        let action = describe(&shipped, |path, root| {
            assert_eq!(path, std::path::Path::new("/extensions/blocker/icon32.png"));
            assert_eq!(root, std::path::Path::new("/extensions/blocker"));
            Some(vec![1, 2, 3])
        })
        .unwrap();
        assert_eq!(action.icon.as_deref(), Some("data:image/png;base64,AQID"));
        assert_eq!((action.badge.as_str(), action.badge_color.as_str(), action.popup), ("3", "#cc0000", true));

        // An icon the extension drew is passed through; nothing is read from disk.
        let drawn = json!({
            "id": "a", "name": "Drawn", "title": "", "enabled": false, "badge": "", "badgeColor": "#000000",
            "popup": false, "icon": "data:image/png;base64,AAAA"
        });
        let action = describe(&drawn, |_, _| panic!("no file to read")).unwrap();
        assert_eq!(action.icon.as_deref(), Some("data:image/png;base64,AAAA"));
        assert!(!action.enabled);
    }

    #[test]
    fn a_popup_is_sized_by_its_content_within_the_bounds_chrome_gives_one() {
        let state = |width, height, closing| Some(PopupState { width, height, closing });
        assert_eq!(popup_state(&json!([320, 480, false])), state(320.0, 480.0, false));
        assert_eq!(popup_state(&json!([4000, 3000, false])), state(800.0, 600.0, false));
        assert_eq!(popup_state(&json!([0, 0, true])), state(25.0, 25.0, true));
        assert_eq!(popup_state(&json!(null)), None);
    }

    #[test]
    fn a_missing_or_unknown_icon_leaves_the_button_without_one() {
        let base = |icon: Value| {
            let mut value = json!({"id": "a", "name": "N", "enabled": true, "popup": false, "root": "/e"});
            value.as_object_mut().unwrap().extend(icon.as_object().unwrap().clone());
            value
        };
        assert_eq!(describe(&base(json!({"iconPath": ""})), |_, _| panic!("nothing to read")).unwrap().icon, None);
        assert_eq!(
            describe(&base(json!({"iconPath": "/e/icon.exe"})), |_, _| panic!("not an image")).unwrap().icon,
            None
        );
        assert_eq!(describe(&base(json!({"iconPath": "/e/huge.png"})), |_, _| None).unwrap().icon, None);
        // Only image data is taken as an icon.
        assert_eq!(describe(&base(json!({"icon": "javascript:alert(1)"})), |_, _| None).unwrap().icon, None);
        // A description without an identity is not a button.
        assert!(describe(&json!({"name": "N", "enabled": true, "popup": false}), |_, _| None).is_none());
    }

    #[test]
    fn an_icon_is_read_only_from_inside_the_extensions_own_directory() {
        let directory = std::env::temp_dir().join(format!("alwith-icon-{}", uuid::Uuid::new_v4()));
        let root = directory.join("extension");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("icon.png"), [7]).unwrap();
        std::fs::write(directory.join("secret.png"), [9]).unwrap();
        assert_eq!(read_icon(&root.join("icon.png"), &root), Some(vec![7]));
        // A manifest that climbs out, or a link that points out, gets nothing.
        assert_eq!(read_icon(&root.join("../secret.png"), &root), None);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(directory.join("secret.png"), root.join("link.png")).unwrap();
            assert_eq!(read_icon(&root.join("link.png"), &root), None);
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
