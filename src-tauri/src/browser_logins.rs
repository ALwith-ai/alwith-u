//! Saved logins of websites: offered for saving when the user signs in, filled
//! in when they come back. A script in a world of its own watches a tab's forms
//! and reports through a binding the page cannot see; passwords are kept in the
//! system keychain and never leave Rust except into the field they belong to.
//!
//! Only a tab of the user's takes part: not a private tab, and not one a
//! conversation opened or took over, whose page the conversation can read.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Emitter, Manager};

use crate::browser_ai::{BrowserAi, GuestAgent};

const WORLD: &str = "alwith-logins";
pub const BINDING: &str = "__alwithLogin";
const SCRIPT: &str = include_str!("browser_logins.js");

/// What is known of a saved login without its password.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Login {
    origin: String,
    username: String,
    /// When it was last saved or filled, in seconds; the latest is filled first.
    used: u64,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct Index {
    logins: Vec<Login>,
    /// Websites the user never wants asked about.
    never: Vec<String>,
}

/// Where passwords are kept.
enum Secrets {
    /// The system keychain, under a service named for this application.
    #[cfg(target_os = "macos")]
    Keychain(String),
    #[cfg(target_os = "windows")]
    CredentialManager(String),
    /// For the isolated test application, whose logins end with it.
    Memory(Mutex<HashMap<String, String>>),
}

fn account(origin: &str, username: &str) -> String {
    format!("{origin} {username}")
}

impl Secrets {
    fn set(&self, origin: &str, username: &str, password: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain(service) => security_framework::passwords::set_generic_password(
                service,
                &account(origin, username),
                password.as_bytes(),
            )
            .map_err(|error| error.to_string()),
            #[cfg(target_os = "windows")]
            Self::CredentialManager(service) => windows_credentials::set(service, &account(origin, username), password),
            Self::Memory(values) => {
                values.lock().unwrap().insert(account(origin, username), password.to_owned());
                Ok(())
            }
        }
    }
    fn get(&self, origin: &str, username: &str) -> Result<String, String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain(service) => {
                security_framework::passwords::get_generic_password(service, &account(origin, username))
                    .map_err(|error| error.to_string())
                    .and_then(|bytes| String::from_utf8(bytes).map_err(|error| error.to_string()))
            }
            #[cfg(target_os = "windows")]
            Self::CredentialManager(service) => windows_credentials::get(service, &account(origin, username)),
            Self::Memory(values) => {
                values.lock().unwrap().get(&account(origin, username)).cloned().ok_or_else(|| "No such login".into())
            }
        }
    }
    fn delete(&self, origin: &str, username: &str) -> Result<(), String> {
        match self {
            #[cfg(target_os = "macos")]
            Self::Keychain(service) => {
                let _ = security_framework::passwords::delete_generic_password(service, &account(origin, username));
                Ok(())
            }
            #[cfg(target_os = "windows")]
            Self::CredentialManager(service) => windows_credentials::delete(service, &account(origin, username)),
            Self::Memory(values) => {
                values.lock().unwrap().remove(&account(origin, username));
                Ok(())
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_credentials {
    use windows_sys::Win32::{
        Foundation::ERROR_NOT_FOUND,
        Security::Credentials::{
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
        },
    };

    fn target(service: &str, account: &str) -> Result<Vec<u16>, String> {
        let target = format!("{service}/{account}");
        if target.contains('\0') {
            return Err("Credential target contains a null character".into());
        }
        Ok(target.encode_utf16().chain(Some(0)).collect())
    }

    pub fn set(service: &str, account: &str, password: &str) -> Result<(), String> {
        let mut target = target(service, account)?;
        let mut bytes = password.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: bytes.len().try_into().map_err(|_| "Password too large")?,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // CredWriteW copies the blob before returning; no pointer escapes this call.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    pub fn get(service: &str, account: &str) -> Result<String, String> {
        let target = target(service, account)?;
        let mut credential = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // Windows owns the returned allocation until CredFree; copy before releasing it.
        let bytes = unsafe {
            let value = &*credential;
            if value.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize).to_vec()
            }
        };
        unsafe { CredFree(credential.cast()) };
        String::from_utf8(bytes).map_err(|error| error.to_string())
    }

    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        let target = target(service, account)?;
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_NOT_FOUND as i32) {
                return Err(error.to_string());
            }
        }
        Ok(())
    }
}

/// The application's saved logins.
pub struct Logins {
    /// Where the list without passwords is written; nowhere for the test application.
    path: Option<PathBuf>,
    index: Mutex<Index>,
    secrets: Secrets,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs())
}

#[cfg(feature = "dev-backends")]
pub fn migrate_service(path: &std::path::Path, old: &str, new: &str) -> Result<(), String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let index: Index = serde_json::from_slice(&bytes).map_err(|_| "Invalid saved-login index")?;
    let old = Logins::persistent(path.to_owned(), old);
    let new = Logins::persistent(path.to_owned(), new);
    for login in index.logins {
        let password = old.secrets.get(&login.origin, &login.username)?;
        new.secrets.set(&login.origin, &login.username, &password)?;
    }
    Ok(())
}

impl Logins {
    /// Logins kept for good: the list in the application's data, passwords in the keychain.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn persistent(path: PathBuf, identifier: &str) -> Self {
        let index = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Self {
            path: Some(path),
            index: Mutex::new(index),
            #[cfg(target_os = "macos")]
            secrets: Secrets::Keychain(format!("{identifier}.website-logins")),
            #[cfg(target_os = "windows")]
            secrets: Secrets::CredentialManager(format!("{identifier}.website-logins")),
        }
    }
    /// Logins that end with the process.
    pub fn temporary() -> Self {
        Self { path: None, index: Mutex::default(), secrets: Secrets::Memory(Mutex::default()) }
    }
    fn write(&self, index: &Index) -> Result<(), String> {
        match &self.path {
            Some(path) => crate::secret_store::write_json(path, index),
            None => Ok(()),
        }
    }
    pub fn all(&self) -> Vec<Login> {
        let mut logins = self.index.lock().unwrap().logins.clone();
        logins.sort_by(|a, b| a.origin.cmp(&b.origin).then(b.used.cmp(&a.used)));
        logins
    }
    /// The logins of one website, the one used last first.
    pub fn of(&self, origin: &str) -> Vec<Login> {
        let mut logins: Vec<_> =
            self.index.lock().unwrap().logins.iter().filter(|login| login.origin == origin).cloned().collect();
        logins.sort_by_key(|login| std::cmp::Reverse(login.used));
        logins
    }
    fn never_asks(&self, origin: &str) -> bool {
        self.index.lock().unwrap().never.iter().any(|never| never == origin)
    }
    pub fn password(&self, origin: &str, username: &str) -> Result<String, String> {
        self.secrets.get(origin, username)
    }
    pub fn save(&self, origin: &str, username: &str, password: &str) -> Result<(), String> {
        self.secrets.set(origin, username, password)?;
        let mut index = self.index.lock().unwrap();
        index.logins.retain(|login| login.origin != origin || login.username != username);
        index.logins.push(Login { origin: origin.into(), username: username.into(), used: now() });
        self.write(&index)
    }
    fn touch(&self, origin: &str, username: &str) {
        let mut index = self.index.lock().unwrap();
        if let Some(login) = index.logins.iter_mut().find(|login| login.origin == origin && login.username == username)
        {
            login.used = now();
            let _ = self.write(&index);
        }
    }
    pub fn delete(&self, origin: &str, username: &str) -> Result<(), String> {
        self.secrets.delete(origin, username)?;
        let mut index = self.index.lock().unwrap();
        index.logins.retain(|login| login.origin != origin || login.username != username);
        self.write(&index)
    }
    fn never(&self, origin: &str) -> Result<(), String> {
        let mut index = self.index.lock().unwrap();
        if !index.never.iter().any(|never| never == origin) {
            index.never.push(origin.into());
        }
        self.write(&index)
    }
    /// What signing in with these calls for: nothing, or asking the user.
    fn offer(&self, origin: &str, username: &str, password: &str) -> Offer {
        if self.never_asks(origin) {
            return Offer::Nothing;
        }
        let known =
            self.index.lock().unwrap().logins.iter().any(|login| login.origin == origin && login.username == username);
        if !known {
            return Offer::Save;
        }
        match self.password(origin, username) {
            Ok(saved) if saved == password => {
                self.touch(origin, username);
                Offer::Nothing
            }
            _ => Offer::Update,
        }
    }
}

#[derive(Debug, PartialEq)]
enum Offer {
    Nothing,
    Save,
    Update,
}

/// The question a tab shows after the user signed in: keep this login?
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPrompt {
    id: u64,
    origin: String,
    username: String,
    /// A login of this name is saved with another password.
    update: bool,
}

/// What a tab's login script last said, kept until it is needed.
#[derive(Default)]
pub struct TabLogins {
    /// The script's world in the document now showing, where a login is filled in.
    context: Option<(String, i64)>,
    /// The name given on the page before the one that asks for the password.
    username: String,
    /// The password the prompt on screen asks about.
    pending: Option<(u64, String)>,
    /// A sign-in not yet asked about, and the document it was made in: the
    /// question waits to see whether the website asks for the password again.
    offer: Option<(LoginPrompt, i64)>,
    /// The watching script, as the browser names it; none before it is added or after it is removed.
    script: Option<String>,
    /// A conversation took the tab over: it is watched no more.
    taken: bool,
}

/// Start watching a tab's forms. Asked once; the browser runs the script in every document after.
pub async fn watch(agent: &GuestAgent, target: &crate::browser_ai::GuestTarget) -> Result<(), String> {
    // Held throughout, so a conversation taking the tab over waits for this to finish before it undoes it.
    let _watching = agent.login_watch.lock().await;
    if agent.logins.lock().unwrap().taken {
        return Ok(());
    }
    // A binding's calls are only reported while the runtime domain is enabled.
    agent.call(target, "Runtime.enable", json!({})).await?;
    agent.call(target, "Runtime.addBinding", json!({"name": BINDING, "executionContextName": WORLD})).await?;
    let added = agent
        .call(
            target,
            "Page.addScriptToEvaluateOnNewDocument",
            json!({"source": SCRIPT, "worldName": WORLD, "runImmediately": true}),
        )
        .await?;
    agent.logins.lock().unwrap().script = added["identifier"].as_str().map(str::to_owned);
    Ok(())
}

/// Stop watching: a conversation is taking the tab over, and this returns
/// before its connection is served. The page agent's state is shared with that
/// connection, and a runtime domain left enabled here would keep the
/// conversation from being told of the page's execution contexts when it
/// enables the domain itself. The tab is not watched again.
pub async fn unwatch(agent: &GuestAgent, target: &crate::browser_ai::GuestTarget) {
    agent.logins.lock().unwrap().taken = true;
    let _watching = agent.login_watch.lock().await;
    let script = {
        let mut logins = agent.logins.lock().unwrap();
        logins.context = None;
        logins.script.take()
    };
    let Some(script) = script else { return };
    let _ = agent.call(target, "Page.removeScriptToEvaluateOnNewDocument", json!({"identifier": script})).await;
    let _ = agent.call(target, "Runtime.removeBinding", json!({"name": BINDING})).await;
    let _ = agent.call(target, "Runtime.disable", json!({})).await;
}

/// The script's report, if this protocol event is one. It goes no further than here.
pub fn report(method: &str, params: &[u8]) -> Option<(Value, i64)> {
    if method != "Runtime.bindingCalled" {
        return None;
    }
    let params: Value = serde_json::from_slice(params).ok()?;
    if params["name"] != BINDING {
        return None;
    }
    let payload = serde_json::from_str(params["payload"].as_str()?).ok()?;
    Some((payload, params["executionContextId"].as_i64()?))
}

/// Take a report of the login script out of a tab's protocol stream, in either
/// of the two forms each event arrives in, and act on it. It is the
/// application's alone: nothing else that reads the stream sees it.
pub fn intercept(
    app: &tauri::AppHandle, label: &str, agent: &std::sync::Arc<GuestAgent>,
    message: &tauri_runtime_cef::DevToolsProtocol,
) -> bool {
    use tauri_runtime_cef::DevToolsProtocol;
    match message {
        DevToolsProtocol::Event { method, params } => match report(method, params) {
            Some((payload, context)) => {
                tauri::async_runtime::spawn(reported(app.clone(), label.to_owned(), agent.clone(), payload, context));
                true
            }
            None => false,
        },
        DevToolsProtocol::Message(bytes) => {
            serde_json::from_slice::<Value>(bytes).is_ok_and(|value| value["params"]["name"] == BINDING)
        }
        _ => false,
    }
}

static NEXT_PROMPT: AtomicU64 = AtomicU64::new(1);

/// How long a website is given to show its sign-in form again before the user is asked to keep the login.
const SETTLE: std::time::Duration = std::time::Duration::from_millis(2500);

/// How often, and how far apart, a form that is still shown after a sign-in is looked at again
/// before the sign-in counts as refused.
const ASKING_CHECKS: usize = 6;
const ASKING_PAUSE: std::time::Duration = std::time::Duration::from_millis(1000);

/// Whether the document a sign-in was made in still shows a password field. A document that is
/// gone, or a tab that no longer answers, is not asking.
async fn still_asking(app: &tauri::AppHandle, label: &str, agent: &GuestAgent, context: i64) -> bool {
    let Some(target) = agent.view(app, label) else { return false };
    agent
        .call(
            &target,
            "Runtime.evaluate",
            json!({"expression": "globalThis.__alwithAsking()", "contextId": context, "returnByValue": true}),
        )
        .await
        .is_ok_and(|answer| answer["result"]["value"] == true)
}

/// Whether this tab is the user's alone: only then are its logins saved and filled.
fn users_own(app: &tauri::AppHandle, label: &str, agent: &GuestAgent) -> bool {
    !agent.private.load(Ordering::Relaxed) && !app.state::<BrowserAi>().owners.lock().unwrap().contains_key(label)
}

fn web_origin(payload: &Value) -> Option<String> {
    let origin = payload["origin"].as_str()?;
    let url: tauri::Url = origin.parse().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

async fn fill(
    app: &tauri::AppHandle, label: &str, agent: &GuestAgent, origin: &str, username: &str, replace: bool,
) -> Result<(), String> {
    let logins = app.state::<Logins>();
    let (context_origin, context) =
        agent.logins.lock().unwrap().context.clone().ok_or("This page has no login form")?;
    if context_origin != origin {
        return Err("This login belongs to another website".into());
    }
    let password = logins.password(origin, username)?;
    let target = agent.view(app, label).ok_or("Guest closed")?;
    let login = json!({"username": username, "password": password, "replace": replace});
    agent
        .call(
            &target,
            "Runtime.evaluate",
            json!({"expression": format!("globalThis.__alwithFill({login})"), "contextId": context}),
        )
        .await?;
    logins.touch(origin, username);
    Ok(())
}

/// Act on what a tab's login script reported.
pub async fn reported(
    app: tauri::AppHandle, label: String, agent: std::sync::Arc<GuestAgent>, payload: Value, context: i64,
) {
    let Some(origin) = web_origin(&payload) else { return };
    if !users_own(&app, &label, &agent) {
        return;
    }
    let logins = app.state::<Logins>();
    match payload["kind"].as_str() {
        Some("fields") => {
            {
                let mut tab = agent.logins.lock().unwrap();
                tab.context = Some((origin.clone(), context));
                // Another document of the website asks for the password again: the sign-in failed.
                if tab.offer.as_ref().is_some_and(|(offer, document)| offer.origin == origin && *document != context) {
                    tab.offer = None;
                    tab.pending = None;
                }
            }
            if let Some(login) = logins.of(&origin).first() {
                let _ = fill(&app, &label, &agent, &origin, &login.username, false).await;
            }
        }
        Some("name") => {
            agent.logins.lock().unwrap().username = payload["username"].as_str().unwrap_or_default().to_owned();
        }
        Some("submit") => {
            let Some(password) = payload["password"].as_str().filter(|password| !password.is_empty()) else { return };
            let username = match payload["username"].as_str().unwrap_or_default() {
                "" => agent.logins.lock().unwrap().username.clone(),
                username => username.to_owned(),
            };
            let update = match logins.offer(&origin, &username, password) {
                Offer::Nothing => return,
                Offer::Save => false,
                Offer::Update => true,
            };
            let prompt = LoginPrompt { id: NEXT_PROMPT.fetch_add(1, Ordering::Relaxed), origin, username, update };
            let id = prompt.id;
            {
                let mut tab = agent.logins.lock().unwrap();
                tab.pending = Some((id, password.to_owned()));
                tab.offer = Some((prompt, context));
            }
            // Asked once the website has had time to answer the sign-in. A website that answers without
            // loading a document takes its form away when it accepts; one still asking refused.
            tokio::time::sleep(SETTLE).await;
            let current = |agent: &GuestAgent| {
                agent.logins.lock().unwrap().offer.as_ref().is_some_and(|(offer, _)| offer.id == id)
            };
            let mut asking = still_asking(&app, &label, &agent, context).await;
            for _ in 0..ASKING_CHECKS {
                if !asking || !current(&agent) {
                    break;
                }
                tokio::time::sleep(ASKING_PAUSE).await;
                asking = still_asking(&app, &label, &agent, context).await;
            }
            if asking {
                let mut tab = agent.logins.lock().unwrap();
                if tab.offer.as_ref().is_some_and(|(offer, _)| offer.id == id) {
                    tab.offer = None;
                    tab.pending = None;
                }
                return;
            }
            let offer = {
                let mut tab = agent.logins.lock().unwrap();
                if tab.offer.as_ref().is_some_and(|(offer, _)| offer.id == id) { tab.offer.take() } else { None }
            };
            if let Some((prompt, _)) = offer {
                agent.chrome.lock().unwrap().login = Some(prompt.clone());
                let _ = app.emit_to("main", "browser-tab-updated", json!({"label": label, "login": prompt}));
            }
        }
        _ => {}
    }
}

fn main_only(webview: &tauri::Webview) -> Result<(), String> {
    (webview.label() == "main").ok_or_else(|| "Only the main document manages logins".into())
}

/// Answer the question a tab shows after a sign-in: `save`, `never` for this website, or `dismiss`.
#[tauri::command]
pub fn cef_guest_login_answer(webview: tauri::Webview, label: String, id: u64, action: String) -> Result<(), String> {
    main_only(&webview)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    let prompt = {
        let mut chrome = agent.chrome.lock().unwrap();
        if chrome.login.as_ref().is_none_or(|prompt| prompt.id != id) {
            return Err("This question is no longer open".into());
        }
        chrome.login.take().expect("checked above")
    };
    let password = agent.logins.lock().unwrap().pending.take().filter(|(pending, _)| *pending == id);
    let _ = webview.emit_to("main", "browser-tab-updated", json!({"label": label, "login": null}));
    let logins = webview.state::<Logins>();
    match (action.as_str(), password) {
        ("save", Some((_, password))) => logins.save(&prompt.origin, &prompt.username, &password),
        ("never", _) => logins.never(&prompt.origin),
        ("dismiss", _) => Ok(()),
        _ => Err("Unknown answer".into()),
    }
}

/// Every saved login, without its password.
#[tauri::command]
pub fn cef_logins(webview: tauri::Webview) -> Result<Vec<Login>, String> {
    main_only(&webview)?;
    Ok(webview.state::<Logins>().all())
}

/// The logins saved for the website a tab shows.
#[tauri::command]
pub fn cef_guest_logins(webview: tauri::Webview, label: String) -> Result<Vec<Login>, String> {
    main_only(&webview)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    let origin = agent.url.lock().unwrap().parse::<tauri::Url>().map(|url| url.origin().ascii_serialization());
    Ok(origin.map_or_default(|origin| webview.state::<Logins>().of(&origin)))
}

/// Fill a saved login into the form a tab shows, over what is there.
#[tauri::command]
pub async fn cef_guest_fill_login(
    webview: tauri::Webview, label: String, origin: String, username: String,
) -> Result<(), String> {
    main_only(&webview)?;
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    if !users_own(webview.app_handle(), &label, &agent) {
        return Err("Logins are not filled into a conversation's tab or a private one".into());
    }
    fill(webview.app_handle(), &label, &agent, &origin, &username, true).await
}

/// A password no one would guess: twenty characters of letters, digits and a few signs every website accepts.
fn strong_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_.!";
    // Sixteen random bytes to a value; bytes past the largest multiple of the alphabet are passed over.
    let limit = (256 / ALPHABET.len() * ALPHABET.len()) as u8;
    std::iter::repeat_with(uuid::Uuid::new_v4)
        .flat_map(|value| value.into_bytes())
        .filter(|byte| *byte < limit)
        .map(|byte| ALPHABET[usize::from(byte) % ALPHABET.len()] as char)
        .take(20)
        .collect()
}

/// Put a new strong password into the empty password fields of the form a tab
/// shows, as when the user makes an account. It is offered for saving like
/// any other when the form is sent, and never reaches the interface.
#[tauri::command]
pub async fn cef_guest_suggest_password(webview: tauri::Webview, label: String) -> Result<(), String> {
    main_only(&webview)?;
    let app = webview.app_handle();
    let agent = webview.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned().ok_or("Unknown guest")?;
    if !users_own(app, &label, &agent) {
        return Err("Passwords are not made for a conversation's tab or a private one".into());
    }
    let (_, context) = agent.logins.lock().unwrap().context.clone().ok_or("This page has no password field")?;
    let target = agent.view(app, &label).ok_or("Guest closed")?;
    let password = Value::String(strong_password());
    let reply = agent
        .call(
            &target,
            "Runtime.evaluate",
            json!({"expression": format!("globalThis.__alwithSuggest({password})"), "contextId": context, "returnByValue": true}),
        )
        .await?;
    (reply["result"]["value"] == true).ok_or_else(|| "This page has no empty password field".into())
}

#[tauri::command]
pub fn cef_delete_login(webview: tauri::Webview, origin: String, username: String) -> Result<(), String> {
    main_only(&webview)?;
    webview.state::<Logins>().delete(&origin, &username)
}

/// The rows of a comma-separated file: quoted fields may hold commas, line breaks and doubled quotes.
fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = text.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && characters.peek() == Some(&'"') => {
                characters.next();
                field.push('"');
            }
            '"' => quoted = !quoted,
            ',' if !quoted => row.push(std::mem::take(&mut field)),
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            other => field.push(other),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// The logins in a password file exported by another browser, as website, username and password.
/// Every browser names its columns in the first row and they agree on `url`, `username` and
/// `password`; a row for anything but a website, or with no password, is not a login to keep.
pub fn exported_logins(text: &str) -> Result<Vec<(String, String, String)>, String> {
    let mut rows = csv_rows(text).into_iter();
    let header = rows.next().ok_or("The file is empty")?;
    let column = |name: &str| header.iter().position(|title| title.trim().eq_ignore_ascii_case(name));
    let (Some(url), Some(username), Some(password)) = (column("url"), column("username"), column("password")) else {
        return Err("The file is not a password export".into());
    };
    Ok(rows
        .filter_map(|row| {
            let address = tauri::Url::parse(row.get(url)?.trim()).ok()?;
            if !matches!(address.scheme(), "http" | "https") {
                return None;
            }
            let password = row.get(password)?;
            (!password.is_empty()).then(|| {
                (
                    address.origin().ascii_serialization(),
                    row.get(username).cloned().unwrap_or_default(),
                    password.clone(),
                )
            })
        })
        .collect())
}

/// Keeps the logins of a password file another browser exported and says how many there were.
/// The file is read here, so its passwords never pass through the interface.
#[tauri::command]
pub fn cef_import_logins(webview: tauri::Webview, path: String) -> Result<usize, String> {
    main_only(&webview)?;
    let text = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let found = exported_logins(&text)?;
    let logins = webview.state::<Logins>();
    for (origin, username, password) in &found {
        logins.save(origin, username, password)?;
    }
    Ok(found.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uses only a unique test credential, never an existing website login.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "writes an isolated Windows credential; run explicitly on Windows"]
    fn windows_credentials_and_login_index_survive_reopening() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("browser-logins.json");
        let identifier = format!("ai.alwith.u.{}.contract-test", uuid::Uuid::new_v4());
        let logins = Logins::persistent(path.clone(), &identifier);
        let result = std::panic::catch_unwind(|| {
            logins.save("https://a.example", "用户", "first-password").unwrap();
            let reopened = Logins::persistent(path.clone(), &identifier);
            assert_eq!(reopened.password("https://a.example", "用户").unwrap(), "first-password");
            assert_eq!(reopened.all().len(), 1);
            assert!(!std::fs::read_to_string(&path).unwrap().contains("first-password"));
            reopened.save("https://a.example", "用户", "updated-password").unwrap();
            assert_eq!(logins.password("https://a.example", "用户").unwrap(), "updated-password");
            reopened.delete("https://a.example", "用户").unwrap();
            assert!(Logins::persistent(path.clone(), &identifier).all().is_empty());
            assert!(logins.password("https://a.example", "用户").is_err());
        });
        logins.secrets.delete("https://a.example", "用户").unwrap();
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    fn a_password_export_is_read_by_its_column_names() {
        let chrome = "name,url,username,password,note\n\
            Example,https://example.com/login?next=1,ada,\"a,b \"\"quoted\"\"\",\n\
            Local,http://localhost:8080/,dev,pw,\"two\nlines\"\n\
            App,android://hash@com.example/,ada,pw,\n\
            Empty,https://empty.example/,ada,,\n";
        assert_eq!(
            exported_logins(chrome).unwrap(),
            [
                ("https://example.com".to_owned(), "ada".to_owned(), "a,b \"quoted\"".to_owned()),
                ("http://localhost:8080".to_owned(), "dev".to_owned(), "pw".to_owned()),
            ]
        );
        let safari =
            "\u{feff}Title,URL,Username,Password,Notes,OTPAuth\r\nSite,https://site.example/a,grace,secret,,\r\n";
        assert_eq!(
            exported_logins(safari).unwrap(),
            [("https://site.example".to_owned(), "grace".to_owned(), "secret".to_owned())]
        );
        assert!(exported_logins("a,b\n1,2\n").is_err());
        assert!(exported_logins("").is_err());
    }

    #[test]
    fn a_sign_in_is_offered_once_and_again_only_when_the_password_changes() {
        let logins = Logins::temporary();
        assert_eq!(logins.offer("https://a.example", "ada", "one"), Offer::Save);
        logins.save("https://a.example", "ada", "one").unwrap();
        assert_eq!(logins.offer("https://a.example", "ada", "one"), Offer::Nothing);
        assert_eq!(logins.offer("https://a.example", "ada", "two"), Offer::Update);
        // Another name, or the same name elsewhere, is another login.
        assert_eq!(logins.offer("https://a.example", "grace", "one"), Offer::Save);
        assert_eq!(logins.offer("https://b.example", "ada", "one"), Offer::Save);
        logins.save("https://a.example", "ada", "two").unwrap();
        assert_eq!(logins.password("https://a.example", "ada").unwrap(), "two");
        assert_eq!(logins.of("https://a.example").len(), 1);
    }

    #[test]
    fn a_website_the_user_said_never_to_is_not_asked_about() {
        let logins = Logins::temporary();
        logins.never("https://a.example").unwrap();
        assert_eq!(logins.offer("https://a.example", "ada", "one"), Offer::Nothing);
        assert_eq!(logins.offer("https://b.example", "ada", "one"), Offer::Save);
    }

    #[test]
    fn a_deleted_login_is_gone_with_its_password() {
        let logins = Logins::temporary();
        logins.save("https://a.example", "ada", "one").unwrap();
        logins.save("https://a.example", "grace", "two").unwrap();
        logins.delete("https://a.example", "ada").unwrap();
        assert!(logins.password("https://a.example", "ada").is_err());
        assert_eq!(logins.all().iter().map(|login| login.username.as_str()).collect::<Vec<_>>(), ["grace"]);
    }

    /// Touches the real keychain, so it runs only when asked for: `cargo test --lib keychain -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn the_keychain_keeps_a_password_and_gives_it_up_when_deleted() {
        let secrets = Secrets::Keychain("ai.alwith.u.contract-test.website-logins".into());
        secrets.set("https://a.example", "ada", "one").unwrap();
        secrets.set("https://a.example", "ada", "two").unwrap();
        assert_eq!(secrets.get("https://a.example", "ada").unwrap(), "two");
        secrets.delete("https://a.example", "ada").unwrap();
        assert!(secrets.get("https://a.example", "ada").is_err());
    }

    #[test]
    fn a_made_password_is_long_and_of_characters_a_form_accepts() {
        let (one, two) = (strong_password(), strong_password());
        assert_eq!(one.len(), 20);
        assert!(one.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.!".contains(&byte)));
        assert_ne!(one, two);
    }

    #[test]
    fn only_the_scripts_own_binding_is_a_report() {
        let event = |name: &str, payload: &str| {
            serde_json::to_vec(&json!({"name": name, "payload": payload, "executionContextId": 7})).unwrap()
        };
        let own = event(BINDING, r#"{"kind":"fields","origin":"https://a.example"}"#);
        let (payload, context) = report("Runtime.bindingCalled", &own).unwrap();
        assert_eq!((payload["kind"].as_str(), context), (Some("fields"), 7));
        assert_eq!(web_origin(&payload).as_deref(), Some("https://a.example"));
        assert!(report("Runtime.bindingCalled", &event("other", "{}")).is_none());
        assert!(report("Runtime.consoleAPICalled", &own).is_none());
        assert!(web_origin(&json!({"origin": "file:///etc"})).is_none());
    }
}
