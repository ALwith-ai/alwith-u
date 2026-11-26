//! Browser chrome state for embedded guests: what the tab strip and toolbar
//! show. Every value comes from the guest's own native browser.
use crate::browser_ai::{BrowserAi, GuestTarget};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};
use tauri_runtime_cef::{BrowserStatus, KeyChord, ShortcutClaim};

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadError {
    url: String,
    code: i32,
    description: String,
    /// The page was showing and its process ended; nothing failed to load.
    crashed: bool,
}

/// A guest's page process ended under it. The tab says so and offers to load
/// the page again, which starts a new process.
pub fn guest_crashed(app: &tauri::AppHandle, label: &str) {
    let Some(agent) = app.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned() else {
        return;
    };
    let error =
        LoadError { url: agent.url.lock().unwrap().clone(), code: 0, description: String::new(), crashed: true };
    {
        let mut chrome = agent.chrome.lock().unwrap();
        chrome.error = Some(error.clone());
        chrome.loading = false;
        chrome.menu = None;
    }
    let _ = app.emit_to(
        "main",
        "browser-tab-updated",
        json!({"label": label, "error": error, "loading": false, "menu": null}),
    );
}

/// A guest's main frame began a document at `url`.
pub fn guest_document(app: &tauri::AppHandle, label: &str, url: &str) {
    let Some(agent) = app.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned() else {
        return;
    };
    let patch = agent.chrome.lock().unwrap().moved_to(url);
    if patch.is_some() {
        let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "error": null}));
    }
}

/// Silence a guest, or let it be heard again.
#[tauri::command]
pub async fn cef_guest_mute(webview: tauri::Webview, label: String, muted: bool) -> Result<(), String> {
    use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost};
    guest_target(&webview, &label)?
        .browser(move |browser| {
            browser.host().ok_or("Guest closed")?.set_audio_muted(muted.into());
            Ok(())
        })
        .await
}

/// Print the page a guest shows, through the system's print panel.
#[tauri::command]
pub async fn cef_guest_print(webview: tauri::Webview, label: String) -> Result<(), String> {
    use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost};
    guest_target(&webview, &label)?
        .browser(|browser| {
            browser.host().ok_or("Guest closed")?.print();
            Ok(())
        })
        .await
}

/// Cached so a tab that subscribes after the first events still starts correct.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeState {
    loading: bool,
    progress: f64,
    can_go_back: bool,
    can_go_forward: bool,
    favicon: Option<String>,
    error: Option<LoadError>,
    permission: Option<PermissionRequest>,
    dialog: Option<PageDialog>,
    auth: Option<AuthRequest>,
    fullscreen: bool,
    menu: Option<PageMenu>,
    /// The question shown after a sign-in: keep this login?
    pub login: Option<crate::browser_logins::LoginPrompt>,
    /// The website whose certificate the browser refused in this tab. It stays untrusted when the
    /// user goes on regardless, so the address bar must not call its connection secure.
    untrusted: Option<String>,
    /// The address of a failure the tab has moved on from without a new load being counted. The
    /// browser may report that failure once more as its error document goes away; said then, it
    /// would lie over the page that replaced it.
    #[serde(skip)]
    left_behind: Option<String>,
}

/// The context menu the user asked for in a page. A guest has no native window
/// to show one on, so the interface draws it and says which entry was chosen.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMenu {
    id: u64,
    /// In the window the page is composited into, in logical points from its top left corner.
    x: i32,
    y: i32,
    link_url: String,
    image_url: String,
    selection_text: String,
    editable: bool,
    items: Vec<PageMenuItem>,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct PageMenuItem {
    command: i32,
    label: String,
    kind: &'static str,
    enabled: bool,
    checked: bool,
    items: Vec<PageMenuItem>,
}

fn page_menu_items(items: &[tauri_runtime_cef::ContextMenuItem]) -> Vec<PageMenuItem> {
    use tauri_runtime_cef::ContextMenuItemKind as Kind;
    items
        .iter()
        .map(|item| PageMenuItem {
            command: item.command,
            label: item.label.clone(),
            kind: match item.kind {
                Kind::Command => "command",
                Kind::Check => "check",
                Kind::Radio => "radio",
                Kind::Separator => "separator",
                Kind::Submenu => "submenu",
            },
            enabled: item.enabled,
            checked: item.checked,
            items: page_menu_items(&item.items),
        })
        .collect()
}

/// Whether the menu offers this command: an entry that runs something and is enabled.
fn offers(items: &[PageMenuItem], command: i32) -> bool {
    items.iter().any(|item| match item.kind {
        "separator" => false,
        "submenu" => offers(&item.items, command),
        _ => item.enabled && item.command == command,
    })
}

/// A server or proxy waiting for a user name and password.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    id: u64,
    host: String,
    port: u16,
    realm: String,
    is_proxy: bool,
}

/// A JavaScript dialog the page is blocked on until the user answers it.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDialog {
    id: u64,
    kind: &'static str,
    origin: String,
    message: String,
    default_text: String,
}

/// What a page asks the user for. Nothing is granted until the user answers.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    id: u64,
    origin: String,
    kinds: Vec<String>,
}

impl ChromeState {
    /// The tab shows, or has begun a document at, `url`. A navigation begun while a failed one was
    /// still settling starts no new load as the browser counts them, so nothing says "loading"
    /// again, and a tab going back to the address it had reports no change of address either: the
    /// document that replaces the failed one is what says the failure is superseded.
    pub fn moved_to(&mut self, url: &str) -> Option<Value> {
        if url.starts_with("chrome-error:")
            || !self.error.as_ref().is_some_and(|error| !error.crashed && error.url != url)
        {
            return None;
        }
        self.left_behind = self.error.take().map(|error| error.url);
        Some(json!({"error": null}))
    }

    /// Fold one native status into the state. Returns the fields that changed
    /// for the user interface, or `None` when the status carries no state.
    pub fn apply(&mut self, status: &BrowserStatus) -> Option<Value> {
        match status {
            BrowserStatus::Loading { is_loading, can_go_back, can_go_forward } => {
                self.loading = *is_loading;
                self.can_go_back = *can_go_back;
                self.can_go_forward = *can_go_forward;
                if *is_loading {
                    // A new navigation supersedes the previous failure, and the
                    // page that asked for a permission is going away.
                    self.error = None;
                    self.left_behind = None;
                    self.permission = None;
                    self.menu = None;
                    self.progress = 0.0;
                } else {
                    self.progress = 1.0;
                }
                Some(json!({
                    "loading": self.loading,
                    "progress": self.progress,
                    "canGoBack": self.can_go_back,
                    "canGoForward": self.can_go_forward,
                    "error": self.error,
                    "permission": self.permission,
                    "menu": self.menu,
                }))
            }
            BrowserStatus::Fullscreen(fullscreen) => {
                self.fullscreen = *fullscreen;
                Some(json!({"fullscreen": fullscreen}))
            }
            BrowserStatus::Progress(progress) => {
                self.progress = *progress;
                Some(json!({"progress": progress}))
            }
            BrowserStatus::Find { count, active, final_update } => {
                Some(json!({"find": {"count": count, "active": active, "final": final_update}}))
            }
            BrowserStatus::Dialog { id, kind, origin, message, default_text } => {
                use tauri_runtime_cef::DialogKind;
                self.dialog = Some(PageDialog {
                    id: *id,
                    kind: match kind {
                        DialogKind::Alert => "alert",
                        DialogKind::Confirm => "confirm",
                        DialogKind::Prompt => "prompt",
                        DialogKind::BeforeUnload => "beforeunload",
                    },
                    origin: origin.clone(),
                    message: message.clone(),
                    default_text: default_text.clone(),
                });
                Some(json!({"dialog": self.dialog}))
            }
            BrowserStatus::ContextMenu(menu) => {
                self.menu = Some(PageMenu {
                    id: menu.id,
                    x: menu.x,
                    y: menu.y,
                    link_url: menu.link_url.clone(),
                    image_url: menu.image_url.clone(),
                    selection_text: menu.selection_text.clone(),
                    editable: menu.editable,
                    items: page_menu_items(&menu.items),
                });
                Some(json!({"menu": self.menu}))
            }
            BrowserStatus::AuthRequest { id, host, port, realm, is_proxy } => {
                self.auth = Some(AuthRequest {
                    id: *id,
                    host: host.clone(),
                    port: *port,
                    realm: realm.clone(),
                    is_proxy: *is_proxy,
                });
                Some(json!({"auth": self.auth}))
            }
            BrowserStatus::DialogDismissed { id } => {
                if self.dialog.as_ref().is_some_and(|dialog| dialog.id == *id) {
                    self.dialog = None;
                    Some(json!({"dialog": null}))
                } else {
                    None
                }
            }
            BrowserStatus::PermissionRequest { id, origin, kinds } => {
                self.permission = Some(PermissionRequest {
                    id: *id,
                    origin: origin.clone(),
                    kinds: kinds.iter().map(|kind| format!("{kind:?}")).collect(),
                });
                Some(json!({"permission": self.permission}))
            }
            BrowserStatus::PermissionDismissed { id } => {
                if self.permission.as_ref().is_some_and(|request| request.id == *id) {
                    self.permission = None;
                    Some(json!({"permission": null}))
                } else {
                    None
                }
            }
            // A certificate the browser does not trust is the browser's to explain: its own page
            // says what is wrong and lets the user go on where that is still safe to offer.
            BrowserStatus::LoadFailed { url, code, .. } if CERTIFICATE_ERRORS.contains(code) => {
                self.untrusted = tauri::Url::parse(url).ok().map(|address| address.origin().ascii_serialization());
                Some(json!({"untrusted": self.untrusted}))
            }
            BrowserStatus::Address(url) => self.moved_to(url),
            BrowserStatus::LoadFailed { url, .. } if self.left_behind.as_deref() == Some(url) => None,
            BrowserStatus::LoadFailed { url, code, description } => {
                self.error =
                    Some(LoadError { url: url.clone(), code: *code, description: description.clone(), crashed: false });
                self.favicon = None;
                Some(json!({"error": self.error, "favicon": null}))
            }
            _ => None,
        }
    }
}

/// Chromium's `ERR_CERT_*` codes.
const CERTIFICATE_ERRORS: std::ops::RangeInclusive<i32> = -219..=-200;

/// Browser-level commands a guest hands to the tab strip instead of its page.
/// macOS conventions; the page never sees a claimed chord.
pub fn browser_command(chord: KeyChord) -> Option<&'static str> {
    // Cmd+Option+I: a tab's developer tools, as in any browser. A page is an
    // ordinary website and never receives the application's shortcut script.
    if chord.command && chord.alt && !chord.control && !chord.shift && chord.key_code == 0x49 {
        return Some(DEVTOOLS);
    }
    // Cmd+Option+U: the page's source, in a tab.
    if chord.command && chord.alt && !chord.control && !chord.shift && chord.key_code == 0x55 {
        return Some("view-source");
    }
    if !chord.command || chord.control || chord.alt {
        return None;
    }
    Some(match (chord.key_code, chord.shift) {
        (0x4C, false) => "focus-address",
        (0x52, false) => "reload",
        (0x52, true) => "hard-reload",
        (0x54, false) => "new-tab",
        (0x54, true) => "reopen-tab",
        (0x4E, true) => "new-private-tab",
        (0x41, true) => "search-tabs",
        (0x57, false) => "close-tab",
        (0xDB, false) => "back",
        (0xDD, false) => "forward",
        (0xBE, false) => "stop",
        (0x31, false) => "tab-1",
        (0x32, false) => "tab-2",
        (0x33, false) => "tab-3",
        (0x34, false) => "tab-4",
        (0x35, false) => "tab-5",
        (0x36, false) => "tab-6",
        (0x37, false) => "tab-7",
        (0x38, false) => "tab-8",
        (0x39, false) => "tab-last",
        (0xDB, true) => "previous-tab",
        (0xDD, true) => "next-tab",
        // The application's interface zoom, with or without shift for "+".
        // Offered to the page first; see `shortcut_claim`.
        (0x46, false) => "find",
        (0x47, false) => "find-next",
        (0x47, true) => "find-previous",
        // Likewise: a page with its own bookmarking or printing keeps the chord.
        (0x44, false) => "bookmark",
        (0x50, false) => "print",
        (0xBB, _) | (0x6B, false) => "zoom-in",
        (0xBD, false) | (0x6D, false) => "zoom-out",
        (0x30, false) | (0x60, false) => "zoom-reset",
        _ => return None,
    })
}

const DEVTOOLS: &str = "devtools";

/// When a guest hands a chord to the browser. A page that implements its own
/// find keeps it; everything else is the browser's before the page sees it.
pub fn shortcut_claim(chord: KeyChord) -> ShortcutClaim {
    match browser_command(chord) {
        None => ShortcutClaim::Pass,
        Some("find" | "find-next" | "find-previous" | "bookmark" | "print") => ShortcutClaim::ClaimIfUnhandled,
        Some(_) => ShortcutClaim::Claim,
    }
}

/// Search the page, or step to the next match of the same search.
#[tauri::command]
pub async fn cef_guest_find(
    webview: tauri::Webview, label: String, text: String, forward: bool, next: bool,
) -> Result<(), String> {
    use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplBrowserHost};
    let target = guest_target(&webview, &label)?;
    target
        .browser(move |browser| {
            let host = browser.host().ok_or("Guest closed")?;
            if text.is_empty() {
                host.stop_finding(1);
            } else {
                host.find(Some(&CefString::from(text.as_str())), forward.into(), 0, next.into());
            }
            Ok(())
        })
        .await
}

/// Answer the permission request shown for a guest. The request must be the one
/// this guest is currently waiting on. For a screen share the user goes on to
/// choose what is shared in the system's picker: a window when `window` is set,
/// a display otherwise.
#[tauri::command]
pub async fn cef_guest_permission(
    webview: tauri::Webview, label: String, id: u64, allow: bool, window: Option<bool>,
) -> Result<(), String> {
    let target = guest_target(&webview, &label)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    {
        let mut chrome = agent.chrome.lock().unwrap();
        if chrome.permission.as_ref().is_none_or(|request| request.id != id) {
            return Err("This permission request is no longer pending".into());
        }
        chrome.permission = None;
    }
    let _ = webview.emit_to("main", "browser-tab-updated", json!({"label": label, "permission": null}));
    target
        .browser(move |_| {
            let answer = if allow && window == Some(true) {
                tauri_runtime_cef::PermissionAnswer::AllowWindow
            } else if allow {
                tauri_runtime_cef::PermissionAnswer::Allow
            } else {
                tauri_runtime_cef::PermissionAnswer::Deny
            };
            tauri_runtime_cef::answer_permission_request(id, answer);
            Ok(())
        })
        .await
}

/// Save what an address of the page points at, a link's target or an image,
/// into the Downloads folder. The guest fetches it, with its own cookies, and
/// the download is reported like any other.
#[tauri::command]
pub async fn cef_guest_save(webview: tauri::Webview, label: String, url: String) -> Result<(), String> {
    use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplBrowserHost};
    let target = guest_target(&webview, &label)?;
    if !url.parse::<tauri::Url>().is_ok_and(|url| matches!(url.scheme(), "http" | "https")) {
        return Err("Only a web address can be saved".into());
    }
    target
        .browser(move |browser| {
            browser.host().ok_or("Guest closed")?.start_download(Some(&CefString::from(url.as_str())));
            Ok(())
        })
        .await
}

/// The user chose an entry of a guest's context menu, or dismissed it. Only a
/// command the menu offered is run.
#[tauri::command]
pub async fn cef_guest_context_menu(
    webview: tauri::Webview, label: String, id: u64, command: Option<i32>,
) -> Result<(), String> {
    let target = guest_target(&webview, &label)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    {
        let mut chrome = agent.chrome.lock().unwrap();
        let Some(menu) = chrome.menu.as_ref().filter(|menu| menu.id == id) else {
            return Err("This menu is no longer open".into());
        };
        if command.is_some_and(|command| !offers(&menu.items, command)) {
            return Err("The menu does not offer this command".into());
        }
        chrome.menu = None;
    }
    let _ = webview.emit_to("main", "browser-tab-updated", json!({"label": label, "menu": null}));
    target
        .browser(move |_| {
            tauri_runtime_cef::answer_context_menu(id, command);
            Ok(())
        })
        .await
}

/// Answer the JavaScript dialog a guest is blocked on. `text` is a prompt's value.
#[tauri::command]
pub async fn cef_guest_dialog(
    webview: tauri::Webview, label: String, id: u64, accept: bool, text: Option<String>,
) -> Result<(), String> {
    let target = guest_target(&webview, &label)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    {
        let mut chrome = agent.chrome.lock().unwrap();
        if chrome.dialog.as_ref().is_none_or(|dialog| dialog.id != id) {
            return Err("This dialog is no longer open".into());
        }
        chrome.dialog = None;
    }
    let _ = webview.emit_to("main", "browser-tab-updated", json!({"label": label, "dialog": null}));
    target
        .browser(move |_| {
            tauri_runtime_cef::answer_dialog(id, accept, text.as_deref());
            Ok(())
        })
        .await
}

/// Answer the login a guest's request is waiting on, or cancel it with no credentials.
#[tauri::command]
pub async fn cef_guest_auth(
    webview: tauri::Webview, label: String, id: u64, username: Option<String>, password: Option<String>,
) -> Result<(), String> {
    guest_target(&webview, &label)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    {
        let mut chrome = agent.chrome.lock().unwrap();
        if chrome.auth.as_ref().is_none_or(|auth| auth.id != id) {
            return Err("This login request is no longer pending".into());
        }
        chrome.auth = None;
    }
    let _ = webview.emit_to("main", "browser-tab-updated", json!({"label": label, "auth": null}));
    let credentials = username.as_deref().zip(password.as_deref());
    tauri_runtime_cef::answer_auth(id, credentials);
    Ok(())
}

fn guest_target(webview: &tauri::Webview, label: &str) -> Result<GuestTarget, String> {
    if webview.label() != "main" {
        return Err("Only the main document can control browser guests".into());
    }
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned().ok_or("Unknown guest")?;
    agent.view(webview.app_handle(), label).ok_or_else(|| "Guest closed".into())
}

/// A download's place in the user's Downloads folder: the suggested file name
/// only, never a path a website chose, and never over an existing file.
pub fn download_destination(
    directory: &std::path::Path, suggested: &std::path::Path, exists: impl Fn(&std::path::Path) -> bool,
) -> std::path::PathBuf {
    let name = suggested
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .unwrap_or("download");
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    let mut candidate = directory.join(name);
    let mut counter = 1;
    while exists(&candidate) {
        candidate = directory.join(format!("{stem} ({counter}){extension}"));
        counter += 1;
    }
    candidate
}

/// Downloads go to the Downloads folder. Their progress is reported by the
/// guest's own browser status, not from here.
pub fn guest_download(webview: &tauri::Webview, event: tauri::webview::DownloadEvent<'_>) -> bool {
    if let tauri::webview::DownloadEvent::Requested { destination, .. } = event {
        let Ok(directory) = webview.path().download_dir() else { return false };
        *destination = download_destination(&directory, destination, |path| path.exists());
    }
    true
}

/// Stop a download that is still in progress.
#[tauri::command]
pub async fn cef_cancel_download(webview: tauri::Webview, label: String, id: u32) -> Result<(), String> {
    let target = guest_target(&webview, &label)?;
    target
        .browser(move |_| {
            tauri_runtime_cef::cancel_download(id);
            Ok(())
        })
        .await
}

/// Toggle the browser's developer tools for one guest, in a window of their own.
async fn toggle_devtools(target: GuestTarget) {
    use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost};
    let _ = target
        .browser(|browser| {
            let host = browser.host().ok_or("Guest closed")?;
            if host.has_dev_tools() != 0 {
                host.close_dev_tools();
            } else {
                host.show_dev_tools(None, None, None, None);
            }
            Ok(())
        })
        .await;
}

/// Open a guest's developer tools on the element at a point, given as its
/// context menu was: in the window's points from its top left corner.
#[tauri::command]
pub async fn cef_guest_inspect(webview: tauri::Webview, label: String, x: i32, y: i32) -> Result<(), String> {
    use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost, Point};
    guest_target(&webview, &label)?
        .browser(move |browser| {
            browser.host().ok_or("Guest closed")?.show_dev_tools(None, None, None, Some(&Point { x, y }));
            Ok(())
        })
        .await
}

/// The longest page state, encoded, that is kept for a tab to resume with.
pub const PAGE_STATE_LIMIT: usize = 32 * 1024;

/// The state the page a tab shows would need to come back as it is: where it is
/// scrolled to and what its forms hold. None for a private tab, for a tab a
/// conversation works in, and for a page that keeps too much.
#[tauri::command]
pub async fn cef_guest_page_state(webview: tauri::Webview, label: String) -> Result<Option<String>, String> {
    let target = guest_target(&webview, &label)?;
    let ai = webview.state::<BrowserAi>();
    let agent = ai.guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    if agent.private.load(std::sync::atomic::Ordering::Relaxed) || ai.owners.lock().unwrap().contains_key(&label) {
        return Ok(None);
    }
    let reply = agent.call(&target, "CefExtensions.getPageState", json!({})).await?;
    Ok(reply["state"].as_str().filter(|state| state.len() <= PAGE_STATE_LIMIT).map(str::to_owned))
}

/// The most pages of a tab's session history that are kept for it to resume with.
const HISTORY_LIMIT: usize = 50;

/// What a tab keeps of its session history, to start with again when it is
/// restored or reopened: its websites' pages nearest the one it shows. A tab
/// showing anything else keeps none.
pub fn kept_history(history: &tauri_runtime_cef::SessionHistory) -> Option<Value> {
    let website = |url: &str| url.starts_with("https://") || url.starts_with("http://");
    if !website(&history.entries.get(history.shown)?.url) {
        return None;
    }
    let kept: Vec<_> = history.entries.iter().enumerate().filter(|(_, entry)| website(&entry.url)).collect();
    let shown = kept.iter().position(|(index, _)| *index == history.shown)?;
    let end = (shown + HISTORY_LIMIT / 2).max(HISTORY_LIMIT).min(kept.len());
    let start = end.saturating_sub(HISTORY_LIMIT);
    let entries: Vec<_> =
        kept[start..end].iter().map(|(_, entry)| json!({"url": entry.url, "title": entry.title})).collect();
    Some(json!({"entries": entries, "shown": shown - start}))
}

/// Tells the tab its session history as it now stands. A tab a page opened has one like any other.
pub fn report_history(app: &tauri::AppHandle, label: &str, target: &GuestTarget) {
    use tauri_runtime_cef::WebviewCefExt;
    let (app, label) = (app.clone(), label.to_owned());
    let report = move |browser: &tauri_runtime_cef::cef::Browser| {
        if let Some(history) = kept_history(&tauri_runtime_cef::session_history(browser)) {
            let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "history": history}));
        }
    };
    match target {
        GuestTarget::View(view) => {
            let _ = view.with_cef_webview(move |native| report(&native.browser()));
        }
        GuestTarget::Popup(popup) => {
            let _ = popup.with_webview(move |native| {
                if let Some(popup) = native {
                    report(&popup.browser());
                }
            });
        }
    }
}

/// Called on the UI thread from the guest's native callbacks.
pub fn guest_status(app: &tauri::AppHandle, label: &str, status: BrowserStatus) {
    let Some(agent) = app.state::<BrowserAi>().guest_or_keep(label, &status) else { return };
    // A page arrived or the tab moved through its history: what it would resume with changed.
    if matches!(status, BrowserStatus::Loading { is_loading: false, .. } | BrowserStatus::Address(_))
        && let Some(target) = agent.view(app, label)
    {
        report_history(app, label, &target);
    }
    match &status {
        BrowserStatus::Shortcut(chord) => {
            if browser_command(*chord) == Some(DEVTOOLS) {
                if let Some(target) = agent.view(app, label) {
                    tauri::async_runtime::spawn(toggle_devtools(target));
                }
            } else if let Some(command) = browser_command(*chord) {
                let _ = app.emit_to("main", "browser-shortcut", json!({"label": label, "command": command}));
            }
        }
        // Every guest reports its own address, with or without a DevTools client.
        BrowserStatus::Address(url) => {
            let url = {
                let mut current = agent.url.lock().unwrap();
                *current = crate::browser_ai::shown_address(&current, url);
                current.clone()
            };
            let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "url": url}));
        }
        BrowserStatus::Download(progress) => {
            use tauri_runtime_cef::DownloadState;
            let state = match progress.state {
                DownloadState::InProgress => "progress",
                DownloadState::Complete => "finished",
                DownloadState::Canceled => "canceled",
                DownloadState::Interrupted => "failed",
            };
            let download = json!({
                "id": progress.id, "url": progress.url, "path": progress.path,
                "received": progress.received_bytes, "total": progress.total_bytes, "state": state,
            });
            {
                let mut downloads = agent.downloads.lock().unwrap();
                downloads.insert(progress.id, download);
                while downloads.len() > 100 {
                    downloads.pop_first();
                }
            }
            let _ = app.emit_to(
                "main",
                "browser-download",
                json!({
                    "id": progress.id,
                    "label": label,
                    "url": progress.url,
                    "path": progress.path,
                    "received": progress.received_bytes,
                    "total": progress.total_bytes,
                    "state": state,
                }),
            );
        }
        BrowserStatus::Favicon(urls) => {
            let url = urls.iter().find(|url| url.starts_with("http://") || url.starts_with("https://")).cloned();
            let Some(target) = agent.view(app, label) else { return };
            let (app, label) = (app.clone(), label.to_owned());
            // Never re-enter the event loop from inside a native callback.
            tauri::async_runtime::spawn(async move {
                let icon = match url {
                    Some(url) => download_icon(&target, url).await,
                    None => None,
                };
                let Some(agent) = app.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned() else { return };
                agent.chrome.lock().unwrap().favicon = icon.clone();
                let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "favicon": icon}));
            });
        }
        _ => {
            // Chromium keeps zoom per site, so a navigation to another site
            // would otherwise fall back to that site's own level.
            if let Some(target) = agent.view(app, label) {
                let level = *app.state::<BrowserAi>().zoom_level.lock().unwrap();
                tauri::async_runtime::spawn(async move {
                    let _ = apply_zoom(&target, level).await;
                });
            }
            let (abandoned, patch) = {
                let mut chrome = agent.chrome.lock().unwrap();
                let before = chrome.permission.as_ref().map(|request| request.id);
                let patch = chrome.apply(&status);
                (before.filter(|_| chrome.permission.is_none()), patch)
            };
            // A request the page abandoned by navigating is dismissed: never left
            // open for a later answer to grant, and not remembered as a refusal.
            if let (Some(id), false, Some(target)) =
                (abandoned, matches!(status, BrowserStatus::PermissionDismissed { .. }), agent.view(app, label))
            {
                tauri::async_runtime::spawn(async move {
                    let _ = target
                        .browser(move |_| {
                            tauri_runtime_cef::answer_permission_request(
                                id,
                                tauri_runtime_cef::PermissionAnswer::Dismiss,
                            );
                            Ok(())
                        })
                        .await;
                });
            }
            if let Some(Value::Object(mut patch)) = patch {
                patch.insert("label".into(), json!(label));
                let _ = app.emit_to("main", "browser-tab-updated", Value::Object(patch));
            }
        }
    }
}

static APPLICATION: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Lets tab requests, which arrive from the runtime without a handle, reach the interface.
pub fn serve_tab_requests(app: &tauri::AppHandle) {
    let _ = APPLICATION.set(app.clone());
}

/// Whether the browser may open this address in a tab of the user's on its own account.
fn tab_request(url: &str) -> bool {
    url.parse::<tauri::Url>().is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "chrome-extension"))
}

/// A page the browser asked to have opened as a tab.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct RequestedTab {
    url: String,
    /// Behind the tab the user is looking at, not in its place.
    background: bool,
}

/// Pages asked for and not yet taken by the interface. The browser pane may
/// not be showing when an extension opens a page; the request waits for it.
static REQUESTED: std::sync::Mutex<Vec<RequestedTab>> = std::sync::Mutex::new(Vec::new());

/// An extension that keeps asking does not grow the list without bound.
const MAX_REQUESTED: usize = 16;

fn keep_request(waiting: &mut Vec<RequestedTab>, url: String, background: bool) -> bool {
    let kept = tab_request(&url) && waiting.len() < MAX_REQUESTED;
    if kept {
        waiting.push(RequestedTab { url, background });
    }
    kept
}

/// The browser asks for a tab itself, for an extension that opened a page.
pub fn tab_requested(request: tauri_runtime_cef::TabRequest) {
    if keep_request(&mut REQUESTED.lock().unwrap(), request.url, request.background)
        && let Some(app) = APPLICATION.get()
    {
        let _ = app.emit_to("main", "browser-open-tab", ());
    }
}

/// The pages the browser asked to have opened as tabs since they were last taken.
/// The address is passed on as given: the browser knows the tab by it.
#[tauri::command]
pub fn cef_take_tab_requests(webview: tauri::Webview) -> Result<Vec<RequestedTab>, String> {
    if webview.label() != "main" {
        return Err("Only the main document opens tabs".into());
    }
    Ok(std::mem::take(&mut *REQUESTED.lock().unwrap()))
}

const MAX_ICON_BYTES: usize = 256 * 1024;

/// Fetch the icon through the guest's own profile, cache and cookies, so the
/// application document never requests a website resource itself.
async fn download_icon(target: &GuestTarget, url: String) -> Option<String> {
    use base64::Engine;
    use tauri_runtime_cef::cef::{self, *};
    type Reply = std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Option<Vec<u8>>>>>>;
    cef::wrap_download_image_callback! {
        struct IconCallback {
            reply: Reply,
        }
        impl DownloadImageCallback {
            fn on_download_image_finished(
                &self,
                _image_url: Option<&CefString>,
                _http_status_code: ::std::os::raw::c_int,
                image: Option<&mut Image>,
            ) {
                // CEF requires both size outputs.
                let (mut width, mut height) = (0, 0);
                let png = image.and_then(|image| image.as_png(1.0, 1, Some(&mut width), Some(&mut height))).and_then(|value| {
                    let size = value.size();
                    if size == 0 || size > MAX_ICON_BYTES {
                        return None;
                    }
                    // CEF copies into the buffer's existing length.
                    let mut bytes = vec![0; size];
                    (value.data(Some(&mut bytes), 0) == size).then_some(bytes)
                });
                if let Some(reply) = self.reply.lock().unwrap().take() {
                    let _ = reply.send(png);
                }
            }
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let reply: Reply = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    target
        .browser(move |browser| {
            let host = browser.host().ok_or("Guest closed")?;
            let mut callback = IconCallback::new(reply);
            host.download_image(Some(&CefString::from(url.as_str())), 1, 64, 0, Some(&mut callback));
            Ok(())
        })
        .await
        .ok()?;
    let png = tokio::time::timeout(std::time::Duration::from_secs(15), rx).await.ok()?.ok()??;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

/// Chromium's zoom level for a linear scale factor: `factor = 1.2^level`.
pub fn zoom_level(scale_factor: f64) -> Result<f64, String> {
    if !scale_factor.is_finite() || scale_factor <= 0.0 || scale_factor > 5.0 {
        return Err("Zoom must be a positive finite scale factor".into());
    }
    Ok(scale_factor.ln() / 1.2_f64.ln())
}

/// Bring one guest to the application's zoom. Idempotent, so it is safe to
/// repeat on every navigation event.
pub async fn apply_zoom(target: &GuestTarget, level: f64) -> Result<(), String> {
    use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost};
    target
        .browser(move |browser| {
            let host = browser.host().ok_or("Guest closed")?;
            if (host.zoom_level() - level).abs() > 1e-6 {
                host.set_zoom_level(level);
            }
            Ok(())
        })
        .await
}

/// Pages follow the application's one interface zoom; there is no second,
/// browser-only zoom to keep in step with it.
#[tauri::command]
pub async fn cef_set_guest_zoom(webview: tauri::Webview, scale_factor: f64) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the main document can zoom browser guests".into());
    }
    let level = zoom_level(scale_factor)?;
    let state = webview.state::<BrowserAi>();
    *state.zoom_level.lock().unwrap() = level;
    let targets: Vec<_> = {
        let guests = state.guests.lock().unwrap();
        guests.iter().filter_map(|(label, agent)| agent.view(webview.app_handle(), label)).collect()
    };
    for target in targets {
        // A guest that closed meanwhile has nothing left to zoom.
        let _ = apply_zoom(&target, level).await;
    }
    Ok(())
}

/// A page blocked on its own dialog cannot navigate. When the user sends the
/// tab elsewhere, the dialog is dismissed first, as every browser does.
pub async fn release_dialog(app: &tauri::AppHandle, label: &str, target: &GuestTarget) {
    let Some(agent) = app.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned() else { return };
    // A login the user walked away from is cancelled, not left waiting.
    if let Some(auth) = agent.chrome.lock().unwrap().auth.take() {
        let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "auth": null}));
        tauri_runtime_cef::answer_auth(auth.id, None);
    }
    let Some(dialog) = agent.chrome.lock().unwrap().dialog.take() else { return };
    let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "dialog": null}));
    let id = dialog.id;
    let _ = target
        .browser(move |_| {
            tauri_runtime_cef::answer_dialog(id, false, None);
            Ok(())
        })
        .await;
}

/// Address-bar navigation loads natively, so it does not wait on the page's
/// DevTools agent.
pub async fn load(target: &GuestTarget, url: String) -> Result<(), String> {
    use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplFrame};
    target
        .browser(move |browser| {
            let frame = browser.main_frame().ok_or("Guest closed")?;
            frame.load_url(Some(&CefString::from(url.as_str())));
            Ok(())
        })
        .await
}

/// Toolbar navigation acts on the native session history directly.
pub async fn navigate(target: &GuestTarget, action: &str) -> Result<(), String> {
    use tauri_runtime_cef::cef::ImplBrowser;
    let action = action.to_owned();
    target
        .browser(move |browser| {
            match action.as_str() {
                "back" => browser.go_back(),
                "forward" => browser.go_forward(),
                "reload" => browser.reload(),
                "hard-reload" => browser.reload_ignore_cache(),
                "stop" => browser.stop_load(),
                _ => return Err("Unknown history action".into()),
            }
            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_tab_keeps_the_websites_of_its_history_around_the_page_it_shows() {
        use tauri_runtime_cef::{SessionEntry, SessionHistory};
        let page = |url: &str| SessionEntry { url: url.into(), title: format!("Title of {url}"), state: None };
        let history = SessionHistory {
            entries: vec![page("about:blank"), page("https://a.example/"), page("https://b.example/")],
            shown: 1,
        };
        let kept = super::kept_history(&history).unwrap();
        assert_eq!(kept["shown"], 0);
        assert_eq!(kept["entries"][1]["url"], "https://b.example/");
        assert_eq!(kept["entries"][0]["title"], "Title of https://a.example/");
        // A tab showing a page that is no website resumes with nothing.
        assert!(super::kept_history(&SessionHistory { shown: 0, ..history }).is_none());
        assert!(super::kept_history(&SessionHistory::default()).is_none());
        // A long history keeps the pages nearest the one shown.
        let long = SessionHistory {
            entries: (0..120).map(|index| page(&format!("https://a.example/{index}"))).collect(),
            shown: 100,
        };
        let kept = super::kept_history(&long).unwrap();
        let entries = kept["entries"].as_array().unwrap();
        assert_eq!(entries.len(), super::HISTORY_LIMIT);
        assert_eq!(entries[kept["shown"].as_u64().unwrap() as usize]["url"], "https://a.example/100");
    }
    use super::*;

    #[test]
    fn the_browser_opens_only_web_pages_in_a_tab_on_its_own_account() {
        assert!(tab_request("https://darkreader.org/help/"));
        assert!(tab_request("http://127.0.0.1:8080/"));
        // An extension's own pages are tabs too; nothing of the browser's ever is.
        assert!(tab_request("chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html"));
        assert!(!tab_request("chrome://settings/"));
        assert!(!tab_request("file:///etc/passwd"));
        assert!(!tab_request("not a url"));
    }

    #[test]
    fn a_context_menu_is_shown_until_answered_and_runs_only_what_it_offers() {
        use tauri_runtime_cef::{ContextMenu, ContextMenuItem, ContextMenuItemKind as Kind};
        let item = |command, kind, enabled, items| ContextMenuItem {
            command,
            label: format!("Item {command}"),
            kind,
            enabled,
            checked: false,
            items,
        };
        let mut state = ChromeState::default();
        let update = state
            .apply(&BrowserStatus::ContextMenu(ContextMenu {
                id: 7,
                x: 120,
                y: 60,
                link_url: "https://a.example/".into(),
                image_url: String::new(),
                selection_text: String::new(),
                editable: false,
                items: vec![
                    item(100, Kind::Command, true, vec![]),
                    item(-1, Kind::Separator, true, vec![]),
                    item(113, Kind::Command, false, vec![]),
                    item(49000, Kind::Submenu, true, vec![item(49001, Kind::Check, true, vec![])]),
                ],
            }))
            .unwrap();
        assert_eq!(update["menu"]["linkUrl"], "https://a.example/");
        assert_eq!(update["menu"]["items"][3]["items"][0]["kind"], "check");
        let items = &state.menu.as_ref().unwrap().items;
        assert!(offers(items, 100) && offers(items, 49001));
        // Not a separator, a disabled entry, a submenu itself, or anything the menu never had.
        assert!(!offers(items, -1) && !offers(items, 113) && !offers(items, 49000) && !offers(items, 132));
        // The page going away takes its menu with it.
        let update = state
            .apply(&BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false })
            .unwrap();
        assert!(update["menu"].is_null() && state.menu.is_none());
    }

    #[test]
    fn requested_pages_wait_for_the_interface_up_to_a_bound() {
        let mut waiting = Vec::new();
        assert!(keep_request(&mut waiting, "https://a.example/".into(), true));
        assert!(!keep_request(&mut waiting, "chrome://settings/".into(), false));
        for _ in 1..MAX_REQUESTED {
            assert!(keep_request(&mut waiting, "https://b.example/".into(), false));
        }
        assert!(!keep_request(&mut waiting, "https://c.example/".into(), false));
        assert_eq!(waiting.len(), MAX_REQUESTED);
        assert_eq!(waiting[0], RequestedTab { url: "https://a.example/".into(), background: true });
        assert!(!waiting[1].background);
    }
    fn chord(key_code: i32, shift: bool) -> KeyChord {
        KeyChord { key_code, command: true, control: false, shift, alt: false }
    }
    #[test]
    fn only_browser_chords_are_claimed_from_the_page() {
        assert_eq!(browser_command(chord(0x4C, false)), Some("focus-address"));
        assert_eq!(browser_command(chord(0x54, true)), Some("reopen-tab"));
        assert_eq!(browser_command(chord(0x39, false)), Some("tab-last"));
        assert_eq!(browser_command(chord(0xBB, true)), Some("zoom-in"));
        assert_eq!(browser_command(chord(0x30, false)), Some("zoom-reset"));
        // The numeric keypad zooms too.
        assert_eq!(browser_command(chord(0x6B, false)), Some("zoom-in"));
        assert_eq!(browser_command(chord(0x6D, false)), Some("zoom-out"));
        assert_eq!(browser_command(chord(0x60, false)), Some("zoom-reset"));
        // Editing shortcuts stay with the page.
        for key in [0x41, 0x43, 0x56, 0x58, 0x5A] {
            assert_eq!(browser_command(chord(key, false)), None);
        }
        assert_eq!(browser_command(chord(0x5A, true)), None);
        // A chord with another modifier is some other shortcut.
        assert_eq!(browser_command(KeyChord { alt: true, ..chord(0x4C, false) }), None);
        assert_eq!(browser_command(KeyChord { alt: true, ..chord(0x49, false) }), Some("devtools"));
        assert_eq!(browser_command(KeyChord { alt: true, ..chord(0x55, false) }), Some("view-source"));
        assert_eq!(browser_command(chord(0x44, false)), Some("bookmark"));
        assert_eq!(browser_command(chord(0x50, false)), Some("print"));
        assert_eq!(browser_command(chord(0x49, false)), None);
        assert_eq!(browser_command(KeyChord { control: true, ..chord(0x52, false) }), None);
        assert_eq!(browser_command(KeyChord { command: false, control: true, ..chord(0x52, false) }), None);
    }
    #[test]
    fn find_is_left_to_a_page_that_handles_it_and_other_chords_are_not() {
        assert_eq!(shortcut_claim(chord(0x46, false)), ShortcutClaim::ClaimIfUnhandled);
        assert_eq!(shortcut_claim(chord(0x47, true)), ShortcutClaim::ClaimIfUnhandled);
        assert_eq!(shortcut_claim(chord(0x44, false)), ShortcutClaim::ClaimIfUnhandled);
        assert_eq!(shortcut_claim(chord(0x50, false)), ShortcutClaim::ClaimIfUnhandled);
        assert_eq!(shortcut_claim(chord(0x54, false)), ShortcutClaim::Claim);
        assert_eq!(shortcut_claim(chord(0x43, false)), ShortcutClaim::Pass);
    }
    #[test]
    fn a_download_keeps_only_the_file_name_and_never_replaces_a_file() {
        use std::path::{Path, PathBuf};
        let directory = Path::new("/Users/someone/Downloads");
        let taken = [directory.join("report.pdf"), directory.join("report (1).pdf")];
        let exists = |path: &Path| taken.iter().any(|existing| existing == path);
        assert_eq!(download_destination(directory, Path::new("report.pdf"), exists), directory.join("report (2).pdf"));
        assert_eq!(download_destination(directory, Path::new("new.tar.gz"), exists), directory.join("new.tar.gz"));
        // A website never chooses the folder.
        assert_eq!(
            download_destination(directory, Path::new("../../.ssh/authorized_keys"), exists),
            directory.join("authorized_keys")
        );
        assert_eq!(download_destination(directory, &PathBuf::new(), exists), directory.join("download"));
        assert_eq!(download_destination(directory, Path::new(".."), exists), directory.join("download"));
        assert_eq!(download_destination(directory, Path::new(".env"), |_| false), directory.join(".env"));
    }
    #[test]
    fn a_permission_request_waits_for_its_own_answer() {
        use tauri::webview::PermissionKind;
        let mut state = ChromeState::default();
        let patch = state
            .apply(&BrowserStatus::PermissionRequest {
                id: 7,
                origin: "https://maps.example".into(),
                kinds: vec![PermissionKind::Geolocation, PermissionKind::Notifications],
            })
            .unwrap();
        assert_eq!(patch["permission"]["origin"], "https://maps.example");
        assert_eq!(patch["permission"]["kinds"], json!(["Geolocation", "Notifications"]));
        // The dismissal of some other request leaves this one waiting.
        assert!(state.apply(&BrowserStatus::PermissionDismissed { id: 6 }).is_none());
        assert!(state.permission.is_some());
        assert!(state.apply(&BrowserStatus::PermissionDismissed { id: 7 }).unwrap()["permission"].is_null());
        state.apply(&BrowserStatus::PermissionRequest { id: 8, origin: "https://a.example".into(), kinds: vec![] });
        // Navigating away abandons the request.
        let patch = state
            .apply(&BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false })
            .unwrap();
        assert!(patch["permission"].is_null());
        assert!(state.permission.is_none());
    }
    #[test]
    fn a_page_dialog_stays_until_it_is_answered_or_its_page_goes_away() {
        use tauri_runtime_cef::DialogKind;
        let mut state = ChromeState::default();
        let patch = state
            .apply(&BrowserStatus::Dialog {
                id: 3,
                kind: DialogKind::Prompt,
                origin: "https://a.example".into(),
                message: "Your name?".into(),
                default_text: "guest".into(),
            })
            .unwrap();
        assert_eq!(patch["dialog"]["kind"], "prompt");
        assert_eq!(patch["dialog"]["defaultText"], "guest");
        assert!(state.apply(&BrowserStatus::DialogDismissed { id: 2 }).is_none());
        assert!(state.dialog.is_some());
        assert!(state.apply(&BrowserStatus::DialogDismissed { id: 3 }).unwrap()["dialog"].is_null());
    }
    #[test]
    fn interface_zoom_maps_to_the_native_level_and_rejects_nonsense() {
        assert_eq!(zoom_level(1.0), Ok(0.0));
        assert!((zoom_level(1.2).unwrap() - 1.0).abs() < 1e-9);
        assert!((zoom_level(0.5).unwrap() - 0.5_f64.ln() / 1.2_f64.ln()).abs() < 1e-9);
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, 5.1] {
            assert!(zoom_level(bad).is_err());
        }
    }
    #[test]
    fn a_new_navigation_clears_the_previous_failure_and_restarts_progress() {
        let mut state = ChromeState::default();
        state.apply(&BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false });
        state.apply(&BrowserStatus::Progress(0.4));
        let patch = state
            .apply(&BrowserStatus::LoadFailed {
                url: "https://down.example/".into(),
                code: -105,
                description: "ERR_NAME_NOT_RESOLVED".into(),
            })
            .unwrap();
        assert_eq!(patch["error"]["code"], -105);
        let patch = state
            .apply(&BrowserStatus::Loading { is_loading: false, can_go_back: true, can_go_forward: false })
            .unwrap();
        // The failure stays visible after loading stops.
        assert_eq!(patch["error"]["code"], -105);
        assert_eq!(patch["progress"], 1.0);
        assert_eq!(patch["canGoBack"], true);
        let patch = state
            .apply(&BrowserStatus::Loading { is_loading: true, can_go_back: true, can_go_forward: false })
            .unwrap();
        assert!(patch["error"].is_null());
        assert_eq!(patch["progress"], 0.0);
        assert!(state.apply(&BrowserStatus::Shortcut(chord(0x4C, false))).is_none());
    }
    #[test]
    fn an_address_other_than_the_failed_one_clears_the_failure_without_a_new_load() {
        let mut state = ChromeState::default();
        state.apply(&BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false });
        let failed = BrowserStatus::LoadFailed {
            url: "http://down.example/".into(),
            code: -102,
            description: "ERR_CONNECTION_REFUSED".into(),
        };
        state.apply(&failed);
        // The failed address itself, and the browser's own error document, leave the failure up.
        assert!(state.apply(&BrowserStatus::Address("http://down.example/".into())).is_none());
        assert!(state.apply(&BrowserStatus::Address("chrome-error://chromewebdata/".into())).is_none());
        // The next page arrives before the browser ever stopped loading. Its address may be the one
        // the tab had all along, so its document says so where no change of address does.
        assert!(state.moved_to("http://down.example/").is_none());
        let patch = state.moved_to("http://up.example/").unwrap();
        assert!(patch["error"].is_null());
        assert!(state.apply(&BrowserStatus::Address("http://up.example/next".into())).is_none());
        // The failure reported once more, as its error document goes away, is not put back.
        assert!(state.apply(&failed).is_none());
        // Asked for again, the address that failed fails afresh.
        state.apply(&BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false });
        assert_eq!(state.apply(&failed).unwrap()["error"]["code"], -102);
    }
    #[test]
    fn an_untrusted_certificate_is_left_to_the_browsers_own_page() {
        let mut state = ChromeState::default();
        let failed = |code| BrowserStatus::LoadFailed {
            url: "https://self-signed.example/".into(),
            code,
            description: "ERR_CERT_AUTHORITY_INVALID".into(),
        };
        let patch = state.apply(&failed(-202)).unwrap();
        assert_eq!(patch, json!({"untrusted": "https://self-signed.example"}));
        assert!(state.error.is_none());
        // Its neighbours are failures like any other.
        assert!(state.apply(&failed(-199)).is_some());
        assert!(state.apply(&failed(-220)).is_some());
    }
}
