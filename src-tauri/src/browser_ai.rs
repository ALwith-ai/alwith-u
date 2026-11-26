//! Session-bound MCP transport to the embedded guests' native DevTools agents.
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_runtime_cef::{DevToolsProtocol, WebviewCefExt, allocate_devtools_message_id};
use tokio::sync::oneshot;

type Reply = oneshot::Sender<Result<Value, String>>;

/// Where a guest's native commands are delivered. An adopted popup is addressed
/// by its own handle, so it stays reachable after the tab that opened it closes.
pub enum GuestTarget {
    View(tauri::Webview),
    Popup(tauri_runtime_cef::SurfacePopup),
}

impl GuestTarget {
    /// Run on the UI thread against the guest's native browser.
    pub async fn browser<T: Send + 'static>(
        &self, action: impl FnOnce(tauri_runtime_cef::cef::Browser) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        match self {
            GuestTarget::View(view) => view
                .with_cef_webview(move |native| {
                    let _ = tx.send(action(native.browser().clone()));
                })
                .map_err(|e| e.to_string())?,
            GuestTarget::Popup(popup) => popup
                .with_webview(move |native| {
                    let result = native
                        .map(|popup| popup.browser().clone())
                        .ok_or_else(|| "Popup closed".to_string())
                        .and_then(action);
                    let _ = tx.send(result);
                })
                .map_err(|e| e.to_string())?,
        }
        tokio::time::timeout(Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Guest dispatch timed out".to_string())?
            .map_err(|_| "Guest closed".to_string())?
    }

    /// Run on the UI thread against the guest's native browser host.
    async fn host<T: Send + 'static>(
        popup: &tauri_runtime_cef::SurfacePopup,
        action: impl FnOnce(tauri_runtime_cef::cef::BrowserHost) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        popup
            .with_webview(move |native| {
                use tauri_runtime_cef::cef::ImplBrowser;
                let result = native
                    .and_then(|popup| popup.browser().host())
                    .ok_or_else(|| "Popup closed".to_string())
                    .and_then(action);
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        tokio::time::timeout(Duration::from_secs(10), rx)
            .await
            .map_err(|_| "Popup dispatch timed out".to_string())?
            .map_err(|_| "Popup closed".to_string())?
    }

    /// Ask the native browser to close. Completion is reported by its close event.
    pub async fn close_popup(popup: &tauri_runtime_cef::SurfacePopup) -> Result<(), String> {
        Self::host(popup, |host| {
            use tauri_runtime_cef::cef::ImplBrowserHost;
            host.close_browser(1);
            Ok(())
        })
        .await
    }
}

/// Chrome's page for installed extensions: the one internal page a user's tab may show.
pub const EXTENSIONS_PAGE: &str = "chrome://extensions/";

/// A page of the browser's or of an extension's, not of a website.
fn internal_page(url: &str) -> bool {
    url.starts_with("chrome:") || url.starts_with("chrome-extension:") || url.starts_with("view-source:")
}

/// What a tab of the user's may show besides websites: the extensions page, an
/// extension's own pages (its popup, options, dashboard) and the source of a
/// website.
pub fn user_page(url: &tauri::Url) -> bool {
    url.as_str() == EXTENSIONS_PAGE
        || url.scheme() == "chrome-extension"
        || (url.scheme() == "view-source" && (url.path().starts_with("https://") || url.path().starts_with("http://")))
}

/// The address a tab shows for what its browser reports. A page's source
/// reports the page's own address; the tab keeps saying it shows the source.
pub fn shown_address(current: &str, reported: &str) -> String {
    match current.strip_prefix("view-source:") {
        Some(page) if page == reported => current.to_owned(),
        _ => reported.to_owned(),
    }
}

/// What the browser says to the application rather than to the page's protocol.
#[derive(Debug, PartialEq)]
enum OwnEvent {
    /// An extension's toolbar button changed.
    ActionsChanged,
    /// The tab started or stopped being heard.
    Audible(bool),
    /// The tab was silenced or let be heard, by an extension as much as by the user.
    Muted(bool),
    /// An extension asked for the tab to be the one in front.
    Activate,
    /// An extension asked for the tab to be closed.
    Close,
    /// An extension asked for the tab to be at this place in the strip; negative is the end.
    Move(i64),
    /// An extension asked for the tab to be pinned, or let go.
    Pin(bool),
    /// The same event's other form: each arrives twice, as the raw message and parsed.
    Duplicate,
}

fn flag(params: &[u8], name: &str) -> bool {
    serde_json::from_slice::<Value>(params).ok().and_then(|value| value[name].as_bool()).unwrap_or(false)
}

/// The event of the browser's `CefExtensions` domain a protocol message carries, if any.
fn own_event(message: &DevToolsProtocol) -> Option<OwnEvent> {
    const DOMAIN: &str = "CefExtensions.";
    match message {
        DevToolsProtocol::Event { method, params } if method.starts_with(DOMAIN) => Some(match method.as_str() {
            "CefExtensions.actionsChanged" => OwnEvent::ActionsChanged,
            "CefExtensions.audibleChanged" => OwnEvent::Audible(flag(params, "audible")),
            "CefExtensions.mutedChanged" => OwnEvent::Muted(flag(params, "muted")),
            "CefExtensions.activationRequested" => OwnEvent::Activate,
            "CefExtensions.closeRequested" => OwnEvent::Close,
            "CefExtensions.moveRequested" => OwnEvent::Move(
                serde_json::from_slice::<Value>(params).ok().and_then(|value| value["index"].as_i64()).unwrap_or(-1),
            ),
            "CefExtensions.pinRequested" => OwnEvent::Pin(flag(params, "pinned")),
            _ => OwnEvent::Duplicate,
        }),
        DevToolsProtocol::Message(bytes) => {
            let value = serde_json::from_slice::<Value>(bytes).ok()?;
            (value["id"].is_null() && value["method"].as_str().is_some_and(|method| method.starts_with(DOMAIN)))
                .then_some(OwnEvent::Duplicate)
        }
        _ => None,
    }
}

pub struct GuestAgent {
    /// Recent native downloads, scoped to this guest.
    pub downloads: Mutex<std::collections::BTreeMap<u32, Value>>,
    pub popup: Option<tauri_runtime_cef::SurfacePopup>,
    pub url: Mutex<String>,
    pub title: Mutex<String>,
    pub chrome: Mutex<crate::browser_chrome::ChromeState>,
    /// Private tabs are accessible only to the browser floating chat.
    pub private: std::sync::atomic::AtomicBool,
    /// What the tab's login script last said; see `browser_logins`.
    pub logins: Mutex<crate::browser_logins::TabLogins>,
    /// Held while the login script is being added or removed.
    pub login_watch: tokio::sync::Mutex<()>,
    pending: Mutex<HashMap<i32, Reply>>,
    pub messages: tokio::sync::broadcast::Sender<Value>,
}
impl Default for GuestAgent {
    fn default() -> Self {
        Self {
            downloads: Mutex::default(),
            url: Mutex::default(),
            title: Mutex::default(),
            chrome: Mutex::default(),
            private: Default::default(),
            logins: Mutex::default(),
            login_watch: tokio::sync::Mutex::default(),
            popup: None,
            pending: Mutex::default(),
            messages: tokio::sync::broadcast::channel(4096).0,
        }
    }
}
impl GuestAgent {
    pub fn attach(view: &tauri::Webview, url: &str) -> Result<Arc<Self>, String> {
        let agent = Arc::new(Self::default());
        *agent.url.lock().unwrap() = url.into();
        let weak = Arc::downgrade(&agent);
        let (app, label) = (view.app_handle().clone(), view.label().to_owned());
        view.on_dev_tools_protocol(move |message| {
            // What the browser says of extensions is for the application's toolbar; it is
            // not the page's protocol and never reaches a conversation's connection.
            match own_event(&message) {
                Some(OwnEvent::ActionsChanged) => {
                    let _ = app.emit_to("main", "browser-extension-actions", json!({"label": label}));
                    return;
                }
                Some(OwnEvent::Audible(audible)) => {
                    let _ = app.emit_to("main", "browser-tab-audible", json!({"label": label, "audible": audible}));
                    return;
                }
                Some(OwnEvent::Muted(muted)) => {
                    let _ = app.emit_to("main", "browser-tab-muted", json!({"label": label, "muted": muted}));
                    return;
                }
                Some(OwnEvent::Activate) => {
                    let _ = app.emit_to("main", "browser-tab-focus", json!({"label": label}));
                    return;
                }
                Some(OwnEvent::Close) => {
                    // The interface drops the tab, and with it closes the guest.
                    let _ = app.emit_to("main", "browser-tab-closed", json!({"label": label}));
                    return;
                }
                Some(OwnEvent::Move(index)) => {
                    let _ = app.emit_to("main", "browser-tab-move", json!({"label": label, "index": index}));
                    return;
                }
                Some(OwnEvent::Pin(pinned)) => {
                    let _ = app.emit_to("main", "browser-tab-pin", json!({"label": label, "pinned": pinned}));
                    return;
                }
                Some(OwnEvent::Duplicate) => return,
                None => {}
            }
            let Some(agent) = weak.upgrade() else { return };
            if crate::browser_logins::intercept(&app, &label, &agent, &message) {
                return;
            }
            agent.receive(message);
        })
        .map_err(|e| e.to_string())?;
        Ok(agent)
    }
    pub fn popup(popup: tauri_runtime_cef::SurfacePopup, url: String) -> Arc<Self> {
        Arc::new(Self { url: Mutex::new(url), popup: Some(popup), ..Self::default() })
    }
    pub fn receive(&self, message: DevToolsProtocol) {
        if let DevToolsProtocol::Event { method, params } = &message
            && let Ok(value) = serde_json::from_slice::<Value>(params)
        {
            let url = match method.as_str() {
                "Page.frameNavigated" if value["frame"]["parentId"].is_null() => value["frame"]["url"].as_str(),
                _ => None,
            };
            if let Some(url) = url {
                let mut current = self.url.lock().unwrap();
                *current = shown_address(&current, url);
            }
        }
        match message {
            DevToolsProtocol::Message(bytes) => {
                if let Ok(message) = serde_json::from_slice(&bytes) {
                    let _ = self.messages.send(message);
                }
            }
            DevToolsProtocol::MethodResult { message_id, success, result } => {
                if let Some(reply) = self.pending.lock().expect("CDP replies").remove(&message_id) {
                    let value = serde_json::from_slice(&result)
                        .map_err(|e| e.to_string())
                        .and_then(|v| if success { Ok(v) } else { Err(format!("CDP error: {v}")) });
                    let _ = reply.send(value);
                }
            }
            DevToolsProtocol::Event { method, .. } if method == "Inspector.detached" => self.cancel(),
            _ => {}
        }
    }
    /// The guest's command route. A popup never routes through its opener.
    pub fn view(&self, app: &tauri::AppHandle, label: &str) -> Option<GuestTarget> {
        match &self.popup {
            Some(popup) => Some(GuestTarget::Popup(popup.clone())),
            None => app.get_webview(label).map(GuestTarget::View),
        }
    }
    pub async fn send(&self, target: &GuestTarget, bytes: &[u8]) -> Result<(), String> {
        let popup = match target {
            GuestTarget::View(view) => return view.send_dev_tools_message(bytes).map_err(|e| e.to_string()),
            GuestTarget::Popup(popup) => popup,
        };
        let bytes = bytes.to_vec();
        GuestTarget::host(popup, move |host| {
            use tauri_runtime_cef::cef::ImplBrowserHost;
            (host.send_dev_tools_message(Some(&bytes)) != 0).ok_or_else(|| "CDP message rejected".into())
        })
        .await
    }
    pub fn cancel(&self) {
        let _ = self.messages.send(json!({"method":"Inspector.detached","params":{"reason":"Guest closed"}}));
        for (_, reply) in self.pending.lock().expect("CDP replies").drain() {
            let _ = reply.send(Err("Browser guest closed".into()));
        }
    }
    pub async fn call(&self, view: &GuestTarget, method: &str, params: Value) -> Result<Value, String> {
        let id = allocate_devtools_message_id().map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(&json!({"id":id,"method":method,"params":params})).map_err(|e| e.to_string())?;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().expect("CDP replies").insert(id, tx);
        let result = match self.send(view, &bytes).await {
            Ok(()) => match tokio::time::timeout(Duration::from_secs(20), rx).await {
                Ok(Ok(reply)) => reply,
                _ => Err(format!("CDP {method} did not complete before its deadline")),
            },
            Err(error) => Err(error.to_string()),
        };
        self.pending.lock().expect("CDP replies").remove(&id);
        result
    }
}

struct PreviewReply {
    sender: Reply,
    session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Control {
    pub session_id: String,
    #[serde(skip)]
    pub token: String,
    pub stopping: bool,
}

#[derive(Default)]
pub struct BrowserAi {
    pub compositor_users: Mutex<usize>,
    pub(crate) endpoint: Mutex<String>,
    pub executor: crate::web_automation::Executor,
    preview_gate: tokio::sync::Mutex<()>,
    previews: Mutex<HashMap<String, PreviewReply>>,
    pub sessions: Mutex<HashMap<String, Option<String>>>,
    pub leases: Mutex<HashMap<String, String>>,
    pub detached: tokio::sync::Notify,
    pub controls: Mutex<HashMap<String, Control>>,
    pub blocked: Mutex<std::collections::HashSet<(String, String)>>,
    pub owners: Mutex<HashMap<String, String>>,
    /// The browser floating chat may operate all website tabs, including private ones.
    pub quick_chat: Mutex<Option<String>>,
    tab_requests: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    pub guests: Mutex<HashMap<String, Arc<GuestAgent>>>,
    /// Titles of guests that were titled before they were registered, by label.
    pub early_titles: Mutex<HashMap<String, String>>,
    /// What guests still being created were told before they were registered, by label. A page
    /// from the cache or a resumed history has loaded by then, and what it said then (that it
    /// stopped loading, that there is a page to go forward to) is said only once.
    early_statuses: Mutex<HashMap<String, Vec<tauri_runtime_cef::BrowserStatus>>>,
    /// The application's interface zoom, as a CEF zoom level. Pages follow it.
    pub zoom_level: Mutex<f64>,
}
impl BrowserAi {
    /// From here until `register` or `forget_guest`, what the guest is told is kept for it.
    pub fn expect_guest(&self, label: &str) {
        self.early_statuses.lock().unwrap().insert(label.into(), Vec::new());
    }

    /// A guest that was not created after all: what was kept for it goes.
    pub fn forget_guest(&self, label: &str) {
        self.early_statuses.lock().unwrap().remove(label);
        self.early_titles.lock().unwrap().remove(label);
    }

    /// The guest a status is for. For one still being created the status is kept instead.
    pub fn guest_or_keep(&self, label: &str, status: &tauri_runtime_cef::BrowserStatus) -> Option<Arc<GuestAgent>> {
        // Under the lock `register` holds, so a status is either kept before it or handled after.
        let guests = self.guests.lock().unwrap();
        let guest = guests.get(label).cloned();
        if guest.is_none()
            && let Some(kept) = self.early_statuses.lock().unwrap().get_mut(label)
        {
            kept.push(status.clone());
        }
        guest
    }

    /// Registers a guest, starting from what it was told and titled while it was being created.
    pub fn register(&self, label: &str, agent: Arc<GuestAgent>) {
        let mut guests = self.guests.lock().expect("browser guests");
        if let Some(title) = self.early_titles.lock().unwrap().remove(label) {
            *agent.title.lock().unwrap() = title;
        }
        for status in self.early_statuses.lock().unwrap().remove(label).into_iter().flatten() {
            match &status {
                tauri_runtime_cef::BrowserStatus::Address(url) => {
                    let mut current = agent.url.lock().unwrap();
                    *current = shown_address(&current, url);
                }
                // The tab asks for this state once it listens; nothing is listening yet.
                _ => {
                    agent.chrome.lock().unwrap().apply(&status);
                }
            }
        }
        guests.insert(label.into(), agent);
    }

    pub fn bind_preview(&self, label: &str, request_id: Option<&str>) -> Result<(), String> {
        if let Some(id) = request_id {
            let previews = self.previews.lock().unwrap();
            let reply = previews.get(id).ok_or("Browser open request expired")?;
            self.owners.lock().unwrap().insert(label.into(), reply.session_id.clone());
        }
        Ok(())
    }
    pub fn session(&self, token: &str) -> Option<String> {
        self.sessions.lock().unwrap().get(token).cloned().flatten()
    }
    fn is_quick_chat(&self, session: &str) -> bool {
        self.quick_chat.lock().unwrap().as_deref() == Some(session)
    }
    fn internal(&self, label: &str) -> bool {
        self.guests.lock().unwrap().get(label).is_none_or(|guest| internal_page(&guest.url.lock().unwrap()))
    }
    fn private(&self, label: &str) -> bool {
        self.guests
            .lock()
            .unwrap()
            .get(label)
            .is_some_and(|guest| guest.private.load(std::sync::atomic::Ordering::Relaxed))
    }
    pub fn can_access(&self, token: &str, label: &str) -> bool {
        if self.internal(label) {
            return false;
        }
        if self.executor.is_transport(token) {
            return true;
        }
        let Some(session) = self.session(token) else { return false };
        if self.private(label) && !self.is_quick_chat(&session) {
            return false;
        }
        if self.blocked.lock().unwrap().contains(&(token.into(), label.into())) {
            return false;
        }
        self.controls.lock().unwrap().get(label).is_none_or(|control| control.token == token && !control.stopping)
    }
    pub fn claim(&self, token: &str, label: &str) -> Result<(), String> {
        if self.internal(label) {
            return Err("This tab shows a browser page that only the user operates".into());
        }
        if self.executor.is_transport(token) {
            return Ok(());
        }
        // Keep credential validation and claiming atomic with turn revocation.
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(token).and_then(Option::as_ref).ok_or("Browser session revoked")?;
        if self.private(label) && !self.is_quick_chat(session) {
            return Err("Private tab is unavailable to this conversation".into());
        }
        if self.blocked.lock().unwrap().contains(&(token.into(), label.into())) {
            return Err("The user took over this tab; this turn cannot reclaim it".into());
        }
        let mut controls = self.controls.lock().unwrap();
        if let Some(control) = controls.get(label) {
            if control.token != token || control.stopping {
                return Err(format!(
                    "Tab is controlled by {}; observe browser_list before retrying",
                    control.session_id
                ));
            }
        } else {
            controls
                .insert(label.into(), Control { session_id: session.clone(), token: token.into(), stopping: false });
        }
        Ok(())
    }
    async fn prepare_tabs(&self, app: &tauri::AppHandle) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let (send, receive) = oneshot::channel();
        self.tab_requests.lock().unwrap().insert(id.clone(), send);
        let result = async {
            app.emit_to("main", "browser-prepare-tabs", json!({"id":id})).map_err(|e| e.to_string())?;
            tokio::time::timeout(Duration::from_secs(15), receive)
                .await
                .map_err(|_| "Browser tabs did not become available".to_string())?
                .map_err(|_| "Browser tab preparation was cancelled".to_string())
        }
        .await;
        self.tab_requests.lock().unwrap().remove(&id);
        result
    }
}
#[derive(Deserialize)]
struct Request {
    target: Option<String>,
    method: String,
    #[serde(default)]
    params: Value,
}

fn validate_method(method: &str, params: &Value) -> Result<(), String> {
    let domain = method.split('.').next().unwrap_or("");
    if !matches!(
        domain,
        "Page"
            | "Runtime"
            | "DOM"
            | "DOMSnapshot"
            | "Input"
            | "Accessibility"
            | "Network"
            | "Emulation"
            | "CSS"
            | "Log"
            | "Performance"
    ) {
        return Err("CDP domain is outside this browser guest".into());
    }
    if method == "Page.navigate" {
        let url: tauri::Url =
            params["url"].as_str().ok_or("Missing navigation URL")?.parse().map_err(|e| format!("Invalid URL: {e}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("Navigation requires HTTP(S)".into());
        }
    }
    Ok(())
}

async fn dispatch(
    State(app): State<tauri::AppHandle>, headers: HeaderMap, Json(request): Json<Request>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let state = app.state::<BrowserAi>();
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let bound = state.sessions.lock().expect("browser sessions").get(token).is_some_and(Option::is_some);
    if !bound {
        return Err((StatusCode::UNAUTHORIZED, "Browser session is unbound or revoked".into()));
    }
    if request.method == "open" {
        let url: tauri::Url = request.params["url"]
            .as_str()
            .ok_or((StatusCode::BAD_REQUEST, "Missing URL".into()))?
            .parse()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid URL".into()))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err((StatusCode::BAD_REQUEST, "Preview requires HTTP(S)".into()));
        }
        let session_id = state.session(token).ok_or((StatusCode::UNAUTHORIZED, "Browser session revoked".into()))?;
        let result = open_preview(&app, &session_id, url, Some(token)).await?;
        if let Some(label) = result["target"].as_str() {
            state.claim(token, label).map_err(|e| (StatusCode::CONFLICT, e))?;
            let _ = app.emit_to("main", "browser-control-changed", ());
        }
        return Ok(Json(result));
    }
    if request.method == "list" {
        let tab_info = if state.session(token).is_some_and(|id| state.is_quick_chat(&id)) {
            let info = state.prepare_tabs(&app).await.map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
            if state.session(token).is_none() {
                return Err((StatusCode::UNAUTHORIZED, "Browser session revoked".into()));
            }
            info
        } else {
            json!([])
        };
        let labels: Vec<_> = state.guests.lock().expect("browser guests").keys().cloned().collect();
        let targets: Vec<_> = labels
            .into_iter()
            .filter(|label| !state.internal(label))
            .filter(|label| !state.private(label) || state.session(token).is_some_and(|id| state.is_quick_chat(&id)))
            .filter_map(|label| {
                let agent = state.guests.lock().unwrap().get(&label).cloned()?;
                let url = agent.url.lock().unwrap().clone();
                let owner = state.owners.lock().unwrap().get(&label).cloned();
                let control = state.controls.lock().unwrap().get(&label).cloned();
                let controller = control.as_ref().map(|c| &c.session_id);
                let control_state = if control.as_ref().is_some_and(|c| c.stopping) { "stopping" } else if control.is_some() { "controlled" } else { "idle" };
                let available = state.can_access(token, &label);
                let info = tab_info.as_array().and_then(|tabs| tabs.iter().find(|tab| tab["id"] == label));
                Some(json!({"id":label,"url":url,"title":info.map(|tab| &tab["title"]),"active":info.is_some_and(|tab| tab["active"] == true),"ownerSessionId":owner,"controllerSessionId":controller,"controlState":control_state,"available":available}))
            })
            .collect();
        return Ok(Json(json!({"targets":targets})));
    }
    if !matches!(
        request.method.as_str(),
        "focus" | "close" | "downloads" | "download" | "release" | "claim" | "dialog" | "status"
    ) {
        validate_method(&request.method, &request.params).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    }
    let label = request.target.ok_or((StatusCode::BAD_REQUEST, "An explicit guest target is required".into()))?;
    if state
        .leases
        .lock()
        .unwrap()
        .get(&label)
        .is_some_and(|owner| owner != token && !state.executor.is_transport(owner))
    {
        return Err((StatusCode::CONFLICT, "This tab is in use by another conversation. Use browser_list to find its owner, open your own tab, or have that conversation call browser_release.".into()));
    }

    let agent = state
        .guests
        .lock()
        .expect("browser guests")
        .get(&label)
        .cloned()
        .ok_or((StatusCode::NOT_FOUND, "Unknown browser guest".into()))?;
    state.claim(token, &label).map_err(|e| (StatusCode::CONFLICT, e))?;
    let _ = app.emit_to("main", "browser-control-changed", ());
    if request.method == "claim" {
        return Ok(Json(json!({"ok":true})));
    }
    if request.method == "release" {
        if state.leases.lock().unwrap().contains_key(&label) {
            return Err((StatusCode::CONFLICT, "Disconnect the diagnostic transport before releasing control".into()));
        }
        state.controls.lock().unwrap().remove(&label);
        let _ = app.emit_to("main", "browser-control-changed", ());
        return Ok(Json(json!({"ok":true,"target":label,"released":true})));
    }
    let view = agent.view(&app, &label).ok_or((StatusCode::NOT_FOUND, "Browser guest closed".into()))?;
    if request.method == "downloads" {
        return Ok(Json(json!({"downloads": agent.downloads.lock().unwrap().values().cloned().collect::<Vec<_>>()})));
    }
    if request.method == "status" {
        // What the tab is showing the reader besides its page: a question, a sign-in, a failure.
        let status = serde_json::to_value(&*agent.chrome.lock().unwrap())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(Json(status));
    }
    if request.method == "download" {
        // The browser saves the address itself, as it would for "Save link as", with the tab's cookies.
        let url: tauri::Url = request.params["url"]
            .as_str()
            .ok_or((StatusCode::BAD_REQUEST, "Missing URL".into()))?
            .parse()
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid URL".into()))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err((StatusCode::BAD_REQUEST, "Only a website's document can be saved".into()));
        }
        view.browser(move |browser| {
            use tauri_runtime_cef::cef::{CefString, ImplBrowser, ImplBrowserHost};
            browser.host().ok_or("Browser closed")?.start_download(Some(&CefString::from(url.as_str())));
            Ok(())
        })
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
        return Ok(Json(json!({"ok":true})));
    }
    if request.method == "dialog" {
        let accept = request.params["accept"].as_bool().ok_or((StatusCode::BAD_REQUEST, "Missing answer".into()))?;
        let text = request.params["promptText"].as_str().map(str::to_owned);
        crate::browser_chrome::answer_open_dialog(&app, &label, &agent, &view, accept, text)
            .await
            .map_err(|e| (StatusCode::CONFLICT, e))?;
        return Ok(Json(json!({"ok":true})));
    }
    if request.method == "focus" {
        app.emit_to("main", "browser-tab-focus", json!({"label":label}))
            .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
        return Ok(Json(json!({"ok":true})));
    }
    if request.method == "close" {
        let main = app.get_webview("main").ok_or((StatusCode::BAD_GATEWAY, "Main window closed".into()))?;
        crate::cef_runtime::cef_close_guest(main, label).await.map_err(|e| (StatusCode::BAD_GATEWAY, e))?;
        return Ok(Json(json!({"ok":true})));
    }
    agent.call(&view, &request.method, request.params).await.map(Json).map_err(|e| (StatusCode::BAD_GATEWAY, e))
}

pub fn start(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    crate::browser_chrome::serve_tab_requests(app);
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    *app.state::<BrowserAi>().endpoint.lock().expect("browser endpoint") =
        format!("http://{}/call", listener.local_addr()?);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).expect("browser listener");
        if let Err(error) = axum::serve(
            listener,
            Router::new()
                .route("/call", post(dispatch))
                .route("/cdp/{label}", get(crate::browser_protocol::connect))
                .with_state(app),
        )
        .await
        {
            log::error!("Browser MCP transport stopped: {error}");
        }
    });
    Ok(())
}

#[derive(Serialize)]
pub struct Context {
    token: String,
    env: Vec<Value>,
}
pub(crate) fn main(webview: &tauri::Webview) -> Result<(), String> {
    (webview.label() == "main").ok_or_else(|| "Browser sessions belong to the main application document".into())
}
/// Open the same live browser surface for application links and session-bound agent requests.
async fn open_preview(
    app: &tauri::AppHandle, session_id: &str, url: tauri::Url, token: Option<&str>,
) -> Result<Value, (StatusCode, String)> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err((StatusCode::BAD_REQUEST, "Preview requires HTTP(S)".into()));
    }
    let state = app.state::<BrowserAi>();
    let _guard = tokio::time::timeout(Duration::from_secs(4), state.preview_gate.lock())
        .await
        .map_err(|_| (StatusCode::TOO_MANY_REQUESTS, "Another tab is opening; retry shortly".into()))?;
    if let Some(token) = token
        && state.session(token).as_deref() != Some(session_id)
    {
        return Err((StatusCode::UNAUTHORIZED, "Browser session revoked".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    state.previews.lock().unwrap().insert(id.clone(), PreviewReply { sender, session_id: session_id.to_owned() });
    let result =
        match app.emit_to("main", "browser-preview-open", json!({"id":id,"url":url.as_str(),"sessionId":session_id})) {
            Ok(()) => match tokio::time::timeout(Duration::from_secs(20), receiver).await {
                Ok(Ok(result)) => result,
                _ => Err("Preview UI did not acknowledge opening the page".into()),
            },
            Err(error) => Err(error.to_string()),
        };
    state.previews.lock().unwrap().remove(&id);
    result.map_err(|error| (StatusCode::BAD_GATEWAY, error))
}
#[tauri::command]
pub async fn cef_browser_open_url(webview: tauri::Webview, session_id: String, url: String) -> Result<Value, String> {
    if !matches!(webview.label(), "main" | "chat") {
        return Err("Browser links belong to application chat documents".into());
    }
    if session_id.is_empty() {
        return Err("Missing sessionId".into());
    }
    open_preview(webview.app_handle(), &session_id, url.parse().map_err(|_| "Invalid URL")?, None)
        .await
        .map_err(|(_, message)| message)
}

/// Acknowledge only after the main UI has mounted and navigated its live surface.
#[tauri::command]
pub fn cef_preview_ready(
    webview: tauri::Webview, id: String, label: Option<String>, error: Option<String>,
) -> Result<(), String> {
    main(&webview)?;
    let state = webview.state::<BrowserAi>();
    let result = if let Some(error) = error {
        Err(error)
    } else if let Some(label) = label.filter(|label| state.guests.lock().unwrap().contains_key(label)) {
        Ok(json!({"target":label}))
    } else {
        Err("Preview did not provide a registered guest".into())
    };
    if let Some(reply) = state.previews.lock().unwrap().remove(&id) {
        if let Ok(value) = &result
            && let Some(label) = value["target"].as_str()
        {
            state.owners.lock().unwrap().insert(label.into(), reply.session_id);
        }
        let _ = reply.sender.send(result);
    }
    Ok(())
}
#[tauri::command]
pub fn cef_browser_context(webview: tauri::Webview) -> Result<Context, String> {
    main(&webview)?;
    let app = webview.app_handle();
    let state = app.state::<BrowserAi>();
    let token = uuid::Uuid::new_v4().to_string();
    state.sessions.lock().expect("browser sessions").insert(token.clone(), None);
    Ok(Context {
        token: token.clone(),
        env: vec![
            json!({"name":"ALWITH_BROWSER_ENDPOINT","value":state.endpoint.lock().expect("browser endpoint").clone()}),
            json!({"name":"ALWITH_BROWSER_TOKEN","value":token}),
        ],
    })
}
#[tauri::command]
pub fn cef_browser_bind(webview: tauri::Webview, token: String, session_id: String) -> Result<(), String> {
    main(&webview)?;
    let state = webview.state::<BrowserAi>();
    let mut sessions = state.sessions.lock().expect("browser sessions");
    let binding = sessions.get_mut(&token).ok_or("Unknown browser session token")?;
    if binding.as_ref().is_some_and(|id| id != &session_id) {
        return Err("Browser token already belongs to another session".into());
    }
    *binding = Some(session_id);
    Ok(())
}
#[tauri::command]
pub async fn cef_browser_revoke(webview: tauri::Webview, session_id: String) -> Result<(), String> {
    main(&webview)?;
    {
        let state = webview.state::<BrowserAi>();
        let mut quick = state.quick_chat.lock().unwrap();
        if quick.as_deref() == Some(&session_id) {
            *quick = None;
        }
    }
    webview.state::<BrowserAi>().executor.release(webview.app_handle(), &session_id).await?;
    webview
        .state::<BrowserAi>()
        .sessions
        .lock()
        .expect("browser sessions")
        .retain(|_, id| id.as_ref() != Some(&session_id));
    Ok(())
}

/// Exercise Chromium's native pointer path only in the isolated contract fixture.
#[tauri::command]
pub async fn cef_browser_test_pointer(webview: tauri::Webview, phase: String, x: i32, y: i32) -> Result<(), String> {
    main(&webview)?;
    if !cfg!(all(feature = "hasgard-testing", debug_assertions))
        || !webview.app_handle().config().identifier.ends_with(".contract-test")
        || std::env::var_os("ALWITH_U_CEF_BROWSER_TEST").is_none()
    {
        return Err("Native pointer injection requires an isolated contract fixture".into());
    }
    if !matches!(phase.as_str(), "down" | "move" | "up") {
        return Err("Expected down, move or up".into());
    }
    GuestTarget::View(webview)
        .browser(move |browser| {
            use tauri_runtime_cef::cef::{ImplBrowser, ImplBrowserHost, MouseButtonType, MouseEvent};
            let host = browser.host().ok_or("Browser closed")?;
            let event = MouseEvent { x, y, modifiers: if phase == "up" { 0 } else { 1 << 4 } };
            if phase == "move" {
                host.send_mouse_move_event(Some(&event), 0);
            } else {
                host.send_mouse_click_event(Some(&event), MouseButtonType::LEFT, i32::from(phase == "up"), 1);
            }
            Ok(())
        })
        .await
}

/// Only the trusted main host can associate its floating chat with the browser.
#[tauri::command]
pub fn cef_browser_quick_chat(webview: tauri::Webview, session_id: Option<String>) -> Result<(), String> {
    main(&webview)?;
    if session_id.as_ref().is_some_and(|id| id.is_empty()) {
        return Err("Missing sessionId".into());
    }
    *webview.state::<BrowserAi>().quick_chat.lock().unwrap() = session_id;
    Ok(())
}
#[tauri::command]
pub fn cef_browser_tabs_ready(webview: tauri::Webview, id: String, tabs: Value) -> Result<(), String> {
    main(&webview)?;
    if !tabs.is_array() {
        return Err("Expected tab metadata".into());
    }
    if let Some(send) = webview.state::<BrowserAi>().tab_requests.lock().unwrap().remove(&id) {
        let _ = send.send(tabs);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_guest_starts_from_what_it_was_told_while_it_was_being_created() {
        use tauri_runtime_cef::BrowserStatus;
        let state = BrowserAi::default();
        let loaded = BrowserStatus::Loading { is_loading: false, can_go_back: false, can_go_forward: true };
        // Nobody is being created under this name: what it is told is not kept.
        assert!(state.guest_or_keep("stranger", &loaded).is_none());
        assert!(state.early_statuses.lock().unwrap().is_empty());

        // A page resumed from history loads before its guest is registered.
        state.expect_guest("tab");
        for status in [
            BrowserStatus::Loading { is_loading: true, can_go_back: false, can_go_forward: false },
            BrowserStatus::Address("https://example.com/first".into()),
            loaded.clone(),
        ] {
            assert!(state.guest_or_keep("tab", &status).is_none());
        }
        let guest = Arc::new(GuestAgent::default());
        state.register("tab", guest.clone());
        let chrome = serde_json::to_value(&*guest.chrome.lock().unwrap()).unwrap();
        assert_eq!(chrome["loading"], false);
        assert_eq!(chrome["canGoForward"], true);
        assert_eq!(chrome["canGoBack"], false);
        assert_eq!(*guest.url.lock().unwrap(), "https://example.com/first");
        // Registered, it is told directly and nothing more is kept.
        assert!(state.guest_or_keep("tab", &loaded).is_some());
        assert!(state.early_statuses.lock().unwrap().is_empty());

        // One that was never created leaves nothing behind.
        state.expect_guest("failed");
        state.early_titles.lock().unwrap().insert("failed".into(), "Title".into());
        assert!(state.guest_or_keep("failed", &loaded).is_none());
        state.forget_guest("failed");
        assert!(state.early_statuses.lock().unwrap().is_empty());
        assert!(state.early_titles.lock().unwrap().is_empty());
    }
    #[test]
    fn what_the_browser_says_to_the_application_is_not_the_pages_protocol() {
        let event = |method: &str, params: Value| DevToolsProtocol::Event {
            method: method.into(),
            params: serde_json::to_vec(&params).unwrap(),
        };
        assert_eq!(own_event(&event("CefExtensions.actionsChanged", json!({}))), Some(OwnEvent::ActionsChanged));
        assert_eq!(
            own_event(&event("CefExtensions.audibleChanged", json!({"audible": true}))),
            Some(OwnEvent::Audible(true))
        );
        assert_eq!(
            own_event(&event("CefExtensions.audibleChanged", json!({"audible": false}))),
            Some(OwnEvent::Audible(false))
        );
        let raw = serde_json::to_vec(&json!({"method": "CefExtensions.audibleChanged", "params": {"audible": true}}));
        assert_eq!(own_event(&DevToolsProtocol::Message(raw.unwrap())), Some(OwnEvent::Duplicate));
        assert_eq!(
            own_event(&event("CefExtensions.mutedChanged", json!({"muted": true}))),
            Some(OwnEvent::Muted(true))
        );
        assert_eq!(own_event(&event("CefExtensions.activationRequested", json!({}))), Some(OwnEvent::Activate));
        assert_eq!(own_event(&event("CefExtensions.closeRequested", json!({}))), Some(OwnEvent::Close));
        assert_eq!(own_event(&event("CefExtensions.moveRequested", json!({"index": 2}))), Some(OwnEvent::Move(2)));
        assert_eq!(own_event(&event("CefExtensions.pinRequested", json!({"pinned": true}))), Some(OwnEvent::Pin(true)));
        assert_eq!(own_event(&event("Page.frameNavigated", json!({}))), None);
    }
    #[test]
    fn cached_tab_url_ignores_child_frame_navigation() {
        let agent = GuestAgent { url: Mutex::new("https://initial.example/".into()), ..GuestAgent::default() };
        agent.receive(DevToolsProtocol::Event {
            method: "Page.frameNavigated".into(),
            params: serde_json::to_vec(&json!({"frame":{"parentId":"main","url":"https://iframe.example/"}})).unwrap(),
        });
        assert_eq!(*agent.url.lock().unwrap(), "https://initial.example/");
        agent.receive(DevToolsProtocol::Event {
            method: "Page.frameNavigated".into(),
            params: serde_json::to_vec(&json!({"frame":{"url":"https://login.example/"}})).unwrap(),
        });
        assert_eq!(*agent.url.lock().unwrap(), "https://login.example/");
    }
    #[test]
    fn ownership_is_bound_before_the_first_popup_can_open() {
        let state = BrowserAi::default();
        let (sender, _) = oneshot::channel();
        state
            .previews
            .lock()
            .unwrap()
            .insert("request".into(), PreviewReply { sender, session_id: "conversation".into() });
        state.bind_preview("root", Some("request")).unwrap();
        assert_eq!(state.owners.lock().unwrap().get("root").map(String::as_str), Some("conversation"));
        assert!(state.bind_preview("expired", Some("missing")).is_err());
        assert!(!state.owners.lock().unwrap().contains_key("expired"));
    }
    #[test]
    fn a_tab_on_the_extensions_page_is_closed_to_every_conversation() {
        let state = BrowserAi::default();
        state.sessions.lock().unwrap().insert("a".into(), Some("conversation-a".into()));
        let guest = Arc::new(GuestAgent::default());
        state.guests.lock().unwrap().insert("tab".into(), guest.clone());
        *guest.url.lock().unwrap() = "https://example.com/".into();
        assert!(state.can_access("a", "tab"));
        state.claim("a", "tab").unwrap();
        // Even a tab the conversation already holds, once the user takes it there.
        *guest.url.lock().unwrap() = format!("{EXTENSIONS_PAGE}?id=abc");
        assert!(!state.can_access("a", "tab"));
        assert!(state.claim("a", "tab").is_err());
        // An extension's own page is no more a conversation's than the browser's.
        *guest.url.lock().unwrap() = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html".into();
        assert!(!state.can_access("a", "tab"));
        // Nor is the source of a page, which is the browser's rendering of it.
        *guest.url.lock().unwrap() = "view-source:https://example.com/".into();
        assert!(!state.can_access("a", "tab"));
        assert!(user_page(&"view-source:https://example.com/".parse().unwrap()));
        assert!(!user_page(&"view-source:file:///etc/passwd".parse().unwrap()));
        // The source reports the page's own address and is the source still, until the tab goes elsewhere.
        assert_eq!(
            shown_address("view-source:https://example.com/", "https://example.com/"),
            "view-source:https://example.com/"
        );
        assert_eq!(
            shown_address("view-source:https://example.com/", "https://other.example/"),
            "https://other.example/"
        );
        assert_eq!(shown_address("https://example.com/", "https://example.com/a"), "https://example.com/a");
        // A private tab is the user's alone whatever it shows.
        *guest.url.lock().unwrap() = "https://example.com/".into();
        guest.private.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(!state.can_access("a", "tab"));
        assert!(state.claim("a", "tab").is_err());
        guest.private.store(false, std::sync::atomic::Ordering::Relaxed);
        *guest.url.lock().unwrap() = "https://example.com/".into();
        assert!(state.can_access("a", "tab"));
    }

    #[test]
    fn operating_a_user_tab_does_not_hide_it_from_later_conversations() {
        let state = BrowserAi::default();
        state
            .sessions
            .lock()
            .unwrap()
            .extend([("a".into(), Some("conversation-a".into())), ("b".into(), Some("conversation-b".into()))]);
        state.guests.lock().unwrap().insert("user-tab".into(), Arc::new(GuestAgent::default()));
        state.claim("a", "user-tab").unwrap();
        assert!(!state.owners.lock().unwrap().contains_key("user-tab"));
        state.sessions.lock().unwrap().remove("a");
        state.controls.lock().unwrap().remove("user-tab");
        assert!(!state.can_access("a", "user-tab"));
        assert!(state.can_access("b", "user-tab"));
        state.claim("b", "user-tab").unwrap();
    }

    #[test]
    fn provenance_survives_control_handoff_without_locking_the_page() {
        let state = BrowserAi::default();
        state.sessions.lock().unwrap().extend([
            ("a".into(), Some("conversation-a".into())),
            ("a-reconnected".into(), Some("conversation-a".into())),
            ("b".into(), Some("conversation-b".into())),
            ("unbound".into(), None),
        ]);
        state.guests.lock().unwrap().insert("tab".into(), Arc::new(GuestAgent::default()));
        assert!(state.claim("unbound", "tab").is_err());
        state.owners.lock().unwrap().insert("tab".into(), "conversation-a".into());
        state.claim("a", "tab").unwrap();
        assert!(!state.can_access("a-reconnected", "tab"));
        assert!(!state.can_access("b", "tab"));
        assert!(state.claim("b", "tab").is_err());
        state.sessions.lock().unwrap().remove("a");
        assert!(!state.can_access("a", "tab"));
        assert!(!state.can_access("a-reconnected", "tab"));
        state.controls.lock().unwrap().remove("tab");
        state.claim("b", "tab").unwrap();
        assert_eq!(state.owners.lock().unwrap().get("tab").unwrap(), "conversation-a");
        assert!(!state.can_access("a-reconnected", "tab"));
    }
    #[test]
    fn floating_chat_can_use_private_and_foreign_tabs_without_transferring_ownership() {
        let state = BrowserAi::default();
        state
            .sessions
            .lock()
            .unwrap()
            .extend([("floating".into(), Some("browser-chat".into())), ("other".into(), Some("other-chat".into()))]);
        let guest = Arc::new(GuestAgent::default());
        *guest.url.lock().unwrap() = "https://example.com/".into();
        guest.private.store(true, std::sync::atomic::Ordering::Relaxed);
        state.guests.lock().unwrap().insert("tab".into(), guest.clone());
        state.owners.lock().unwrap().insert("tab".into(), "original-chat".into());
        assert!(!state.can_access("floating", "tab"));
        *state.quick_chat.lock().unwrap() = Some("browser-chat".into());
        state.claim("floating", "tab").unwrap();
        assert!(!state.can_access("other", "tab"));
        assert_eq!(state.owners.lock().unwrap().get("tab").unwrap(), "original-chat");
        *guest.url.lock().unwrap() = EXTENSIONS_PAGE.into();
        assert!(!state.can_access("floating", "tab"));
        *guest.url.lock().unwrap() = "https://example.com/".into();
        *state.quick_chat.lock().unwrap() = None;
        assert!(state.claim("floating", "tab").is_err());
        *state.quick_chat.lock().unwrap() = Some("browser-chat".into());
        state.sessions.lock().unwrap().remove("floating");
        assert!(!state.can_access("floating", "tab"));
    }

    #[test]
    fn protocol_cannot_escape_to_other_browser_targets() {
        for method in
            ["Target.createTarget", "Browser.close", "Target.attachToTarget", "Storage.clearDataForOrigin", ""]
        {
            assert!(validate_method(method, &json!({})).is_err());
        }
        for method in ["DOM.getDocument", "Input.dispatchMouseEvent", "Runtime.evaluate", "Accessibility.getFullAXTree"]
        {
            assert!(validate_method(method, &json!({})).is_ok());
        }
    }
    #[test]
    fn navigation_rejects_local_files_and_script_urls() {
        for url in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,test"] {
            assert!(validate_method("Page.navigate", &json!({"url":url})).is_err());
        }
        assert!(validate_method("Page.navigate", &json!({"url":"https://www.feishu.cn/"})).is_ok());
    }
}
