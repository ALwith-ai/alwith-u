//! A browser-shaped CDP connection exposing exactly one native guest.
//! Root target discovery is virtualized; page and child-session traffic is native CDP.
use crate::browser_ai::BrowserAi;
use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use tauri::{Emitter, Manager};
use tauri_runtime_cef::{WebviewCefExt, allocate_devtools_message_id};

// SurfaceEmbed guests share the trusted host's compositor. Keep it producing
// frames while an authorized automation connection operates a background tab.
struct CompositorActivity(tauri::AppHandle);
impl CompositorActivity {
    fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        let state = app.state::<BrowserAi>();
        let mut users = state.compositor_users.lock().unwrap();
        if *users == 0 {
            Self::set(app, true)?;
        }
        *users += 1;
        Ok(Self(app.clone()))
    }
    fn set(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
        let main = app.get_webview("main").ok_or("Browser host closed")?;
        let id = allocate_devtools_message_id().map_err(|e| e.to_string())?;
        main.send_dev_tools_message(
            json!({"id":id,"method":"Emulation.setFocusEmulationEnabled","params":{"enabled":enabled}})
                .to_string()
                .as_bytes(),
        )
        .map_err(|e| e.to_string())
    }
}
impl Drop for CompositorActivity {
    fn drop(&mut self) {
        let state = self.0.state::<BrowserAi>();
        let mut users = state.compositor_users.lock().unwrap();
        *users -= 1;
        if *users == 0 {
            let _ = Self::set(&self.0, false);
        }
    }
}

const ROOT: &str = "alwith-guest";
struct Lease {
    app: tauri::AppHandle,
    label: String,
    token: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let state = self.app.state::<BrowserAi>();
        let mut leases = state.leases.lock().unwrap();
        if leases.get(&self.label) == Some(&self.token) {
            leases.remove(&self.label);
            state.detached.notify_waiters();
            if !state.executor.is_transport(&self.token) {
                let mut controls = state.controls.lock().unwrap();
                if controls.get(&self.label).is_some_and(|c| c.token == self.token) {
                    controls.remove(&self.label);
                    let _ = self.app.emit_to("main", "browser-control-changed", ());
                }
            }
        }
    }
}
fn authorized(app: &tauri::AppHandle, token: &str) -> bool {
    let state = app.state::<BrowserAi>();
    state.executor.is_transport(token) || state.sessions.lock().unwrap().get(token).is_some_and(Option::is_some)
}
pub async fn connect(
    State(app): State<tauri::AppHandle>, Path(label): Path<String>, headers: HeaderMap, upgrade: WebSocketUpgrade,
) -> Result<Response, (StatusCode, String)> {
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_owned();
    if !authorized(&app, &token) {
        return Err((StatusCode::UNAUTHORIZED, "Unbound or revoked browser session".into()));
    }
    if !app.state::<BrowserAi>().guests.lock().unwrap().contains_key(&label) {
        return Err((StatusCode::NOT_FOUND, "Unknown guest".into()));
    }
    app.state::<BrowserAi>().claim(&token, &label).map_err(|error| (StatusCode::FORBIDDEN, error))?;
    // A native page agent has shared domain state. Never attach competing clients.
    {
        let state = app.state::<BrowserAi>();
        let mut leases = state.leases.lock().unwrap();
        if leases.contains_key(&label) {
            return Err((StatusCode::CONFLICT, "This page is already controlled by another connection".into()));
        }
        leases.insert(label.clone(), token.clone());
    }
    let lease = Lease { app: app.clone(), label: label.clone(), token: token.clone() };
    Ok(upgrade.on_upgrade(move |socket| async move {
        // Suspend login observation while an AI connection controls the page.
        let agent = app.state::<BrowserAi>().guests.lock().unwrap().get(&label).cloned();
        if let Some(agent) = agent
            && let Some(target) = agent.view(&app, &label)
        {
            crate::browser_logins::unwatch(&agent, &target).await;
        }
        serve(socket, &app, &label, &token).await;
        drop(lease);
    }))
}
fn reply(id: &Value, session: Option<&Value>, result: Result<Value, String>) -> Value {
    let mut value = match result {
        Ok(result) => json!({"id":id,"result":result}),
        Err(message) => json!({"id":id,"error":{"code":-32000,"message":message}}),
    };
    if let Some(session) = session {
        value["sessionId"] = session.clone();
    }
    value
}
async fn send(socket: &mut WebSocket, value: Value) -> Result<(), ()> {
    socket.send(Message::Text(value.to_string().into())).await.map_err(|_| ())
}
fn page_method(method: &str, params: &Value) -> Result<(), String> {
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
            | "Fetch"
            | "Debugger"
            | "Security"
            | "Overlay"
            | "Inspector"
            | "IO"
    ) && !matches!(method, "Target.setAutoAttach" | "Target.detachFromTarget" | "Target.getTargetInfo")
    {
        return Err("Command is outside this guest".into());
    }
    if method == "Page.navigate" {
        let url: tauri::Url = params["url"].as_str().ok_or("Missing URL")?.parse().map_err(|_| "Invalid URL")?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("Navigation requires HTTP(S)".into());
        }
    }
    if method == "Target.getTargetInfo" && params.get("targetId").is_some() {
        return Err("Cross-target discovery is unavailable".into());
    }
    Ok(())
}
async fn serve(mut socket: WebSocket, app: &tauri::AppHandle, label: &str, token: &str) {
    let Some(agent) = app.state::<BrowserAi>().guests.lock().unwrap().get(label).cloned() else { return };
    let Some(view) = agent.view(app, label) else { return };
    // The native agent survives WebSocket clients. A fresh Runtime.enable must replay
    // existing main-world contexts to the new client, not retain the previous client's enable state.
    if agent.call(&view, "Runtime.disable", json!({})).await.is_err() {
        return;
    }
    let mut events = agent.messages.subscribe();
    let Ok(info) = agent.call(&view, "Target.getTargetInfo", json!({})).await else { return };
    let target_info = info["targetInfo"].clone();
    if !target_info["targetId"].is_string() {
        return;
    }
    let managed = app.state::<BrowserAi>().executor.is_transport(token);
    let mut activity = None;
    let mut pending: HashMap<i32, (Value, Option<Value>)> = HashMap::new();
    let mut children = HashSet::<String>::new();
    let mut attached = false;
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(250));
    loop {
        let active = !managed || app.state::<BrowserAi>().controls.lock().unwrap().contains_key(label);
        if active != activity.is_some() {
            if active {
                let Ok(value) = CompositorActivity::acquire(app) else { break };
                activity = Some(value);
            } else {
                activity = None;
            }
            if agent.call(&view, "Emulation.setFocusEmulationEnabled", json!({"enabled":active})).await.is_err() {
                break;
            }
        }
        tokio::select! {
            _ = tick.tick() => { if !app.state::<BrowserAi>().can_access(token, label) { break } }
            incoming = socket.recv() => {
                let Some(Ok(Message::Text(text))) = incoming else { break };
                if !app.state::<BrowserAi>().can_access(token, label) { break }
                let Ok(mut message) = serde_json::from_str::<Value>(&text) else { break };
                let id = message["id"].clone();
                let session = message.get("sessionId").cloned();
                let method = message["method"].as_str().unwrap_or("").to_owned();
                let params = message.get("params").cloned().unwrap_or(json!({}));
                if session.is_none() {
                    let result = match method.as_str() {
                        "Browser.getVersion" => agent.call(&view, &method, params).await,
                        "Target.getTargetInfo" if params.get("targetId").is_none() => Ok(json!({"targetInfo":target_info})),
                        "Target.getTargets" => Ok(json!({"targetInfos":[target_info]})),
                        "Target.setAutoAttach" if params["autoAttach"] == true && params["flatten"] == true => {
                            if !attached {
                                attached = true;
                                if send(&mut socket, json!({"method":"Target.attachedToTarget","params":{"sessionId":ROOT,"targetInfo":target_info,"waitingForDebugger":false}})).await.is_err() { break }
                            }
                            Ok(json!({}))
                        }
                        _ => Err("Browser-wide operation is unavailable on an embedded guest".into()),
                    };
                    if send(&mut socket, reply(&id, None, result)).await.is_err() { break }
                    continue;
                }
                let session_name = session.as_ref().and_then(Value::as_str).unwrap_or("");
                let validation = if !attached || (session_name != ROOT && !children.contains(session_name)) {
                    Err("Unknown guest session".into())
                } else { page_method(&method, &params) };
                if let Err(error) = validation {
                    if send(&mut socket, reply(&id, session.as_ref(), Err(error))).await.is_err() { break }
                    continue;
                }
                if pending.len() >= 1024 { break }
                let Ok(native_id) = allocate_devtools_message_id() else { break };
                message["id"] = json!(native_id);
                if session_name == ROOT { message.as_object_mut().unwrap().remove("sessionId"); }
                pending.insert(native_id, (id.clone(), session.clone()));
                if let Err(error) = agent.send(&view, message.to_string().as_bytes()).await {
                    pending.remove(&native_id);
                    if send(&mut socket, reply(&id, session.as_ref(), Err(error.to_string()))).await.is_err() { break }
                }
            }
            event = events.recv() => {
                let Ok(mut message) = event else { break };
                if let Some(id) = message["id"].as_i64() {
                    let Some((id, session)) = pending.remove(&(id as i32)) else { continue };
                    message["id"] = id;
                    if let Some(session) = session { message["sessionId"] = session; }
                } else {
                    if !attached { continue }
                    let method = message["method"].as_str().unwrap_or("");
                    if method == "Inspector.detached" { break }
                    if method == "Target.attachedToTarget" {
                        if let Some(id) = message["params"]["sessionId"].as_str() { children.insert(id.into()); }
                    } else if method == "Target.detachedFromTarget" && let Some(id) = message["params"]["sessionId"].as_str() {
                        children.remove(id);
                    }
                    if message.get("sessionId").is_none() { message["sessionId"] = json!(ROOT); }
                }
                if send(&mut socket, message).await.is_err() { break }
            }
        }
    }
    // Undo debugger pauses before releasing the page to the user or a later connection.
    for session in children.iter().map(Some).chain(std::iter::once(None)) {
        for method in [
            "Runtime.runIfWaitingForDebugger",
            "Debugger.disable",
            "Runtime.disable",
            "Fetch.disable",
            "Target.setAutoAttach",
            "Emulation.setFocusEmulationEnabled",
        ] {
            if let Ok(id) = allocate_devtools_message_id() {
                let mut command = json!({"id":id,"method":method,"params":if method == "Target.setAutoAttach" { json!({"autoAttach":false,"waitForDebuggerOnStart":false,"flatten":true}) } else if method == "Emulation.setFocusEmulationEnabled" { json!({"enabled":false}) } else { json!({}) }});
                if let Some(session) = session {
                    command["sessionId"] = json!(session);
                }
                let _ = agent.send(&view, command.to_string().as_bytes()).await;
            }
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guest_cannot_escape_to_browser_or_another_target() {
        for method in ["Browser.close", "Target.createTarget", "Target.attachToTarget", "Storage.clearCookies"] {
            assert!(page_method(method, &json!({})).is_err());
        }
        assert!(page_method("Target.getTargetInfo", &json!({"targetId":"main"})).is_err());
        assert!(page_method("Page.navigate", &json!({"url":"file:///etc/passwd"})).is_err());
        assert!(page_method("Page.navigate", &json!({"url":"http://localhost:1430"})).is_ok());
        assert!(page_method("Target.setAutoAttach", &json!({"autoAttach":true,"flatten":true})).is_ok());
    }
}
