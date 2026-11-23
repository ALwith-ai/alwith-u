//! U supplies Runtime facts; the shared mobile plugin owns pairing and transport.
use alwith_api::{RuntimeEvent, SessionRunState};
use alwith_mobile::{HostFuture, MobileExt, MobileHost, SessionHistoryContent, SessionHistoryPage};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex, Weak},
};
use tauri::{AppHandle, Emitter, Manager};
mod draft;
mod history;
mod requests;
pub use history::private_event as history_event;

#[derive(Default)]
struct Projection {
    activity: Vec<String>,
    question_tokens: HashMap<String, HashMap<String, String>>,
    states: Vec<SessionRunState>,
}
static PROJECTION: LazyLock<Mutex<Projection>> = LazyLock::new(|| Mutex::new(Projection::default()));

impl Projection {
    fn snapshot(&self) -> Vec<Value> {
        let mut states = project_states(self.states.clone(), &self.activity);
        for state in &mut states {
            if let Some(tokens) = state["sessionId"].as_str().and_then(|id| self.question_tokens.get(id)) {
                state["questionTokens"] = json!(tokens);
            }
        }
        states
    }
}

#[tauri3_specta::command]
pub fn mobile_set_activity_sessions(
    app: AppHandle, session_ids: Vec<String>, question_tokens: Option<HashMap<String, HashMap<String, String>>>,
) -> Result<(), String> {
    let states = {
        let mut projection = PROJECTION.lock().unwrap();
        projection.activity = session_ids;
        projection.question_tokens = question_tokens.unwrap_or_default();
        projection.snapshot()
    };
    app.mobile().publish_run_states(&states).map_err(|error| error.message)
}

fn project_snapshot(states: Vec<SessionRunState>) -> Vec<Value> {
    let mut projection = PROJECTION.lock().unwrap();
    projection.states = states;
    projection.snapshot()
}

/// Answers the phone bridge's questions from U's Runtime.
pub struct Host;
impl MobileHost for Host {
    fn run_states(&self, app: AppHandle) -> HostFuture<Vec<Value>> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            Ok(project_snapshot(client.run_states().await.map_err(crate::runtime::request_error)?))
        })
    }
    fn agent_for_session(&self, _app: AppHandle, _session_id: String) -> HostFuture<Option<String>> {
        // U's conversations belong to its Codex adapter, including retained activity whose
        // Runtime attachment has ended. Reading history must not resume or select it.
        Box::pin(async move { Ok(Some("codex".to_owned())) })
    }
    fn supports_session_history_and_actions(&self) -> bool {
        true
    }
    fn supports_action_status(&self) -> bool {
        true
    }
    fn supports_large_history_content_ranges(&self) -> bool {
        true
    }

    fn session_replay(&self, app: AppHandle, session_id: String) -> HostFuture<Vec<String>> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            history::bounded(async {
                let mut pages = Vec::new();
                let mut cursor = None;
                let mut remaining = LEGACY_BUDGET - 2;
                loop {
                    let page = history::page(&client, &session_id, cursor.as_deref(), remaining).await?;
                    for line in &page.lines {
                        let frame: Value = serde_json::from_str(line).map_err(|error| error.to_string())?;
                        if frame.pointer("/params/update/_meta/codex/historyContent").is_some() {
                            return Err("Large history requires a phone with paged history support".into());
                        }
                        remaining =
                            remaining.checked_sub(encoded_line_bytes(line)?).ok_or("Legacy replay exceeds budget")?;
                    }
                    pages.push(page.lines);
                    cursor = page.next_cursor;
                    if cursor.is_none() {
                        let mut lines: Vec<String> = pages.into_iter().rev().flatten().collect();
                        let state = app.state::<crate::runtime::RuntimeState>();
                        lines.extend(state.mobile_actions.lock().unwrap().permissions(
                            &client,
                            &session_id,
                            remaining,
                        )?);
                        return Ok(lines);
                    }
                }
            })
            .await
        })
    }
    fn session_history_page(
        &self, app: AppHandle, session_id: String, cursor: Option<String>, max_bytes: u32,
    ) -> HostFuture<SessionHistoryPage> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            history::bounded(history::page(&client, &session_id, cursor.as_deref(), max_bytes)).await
        })
    }
    fn session_history_content(
        &self, app: AppHandle, session_id: String, content_id: String, offset: u64, max_bytes: u32,
    ) -> HostFuture<SessionHistoryContent> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            let value = history::bounded(history::request(
                &client,
                "_alwith/mobile_history_content",
                json!({"sessionId":session_id,"contentId":content_id,"offset":offset,"maxBytes":max_bytes}),
            ))
            .await?;
            serde_json::from_value(value).map_err(|error| error.to_string())
        })
    }
    fn mark_read(&self, app: AppHandle, session_id: String) -> HostFuture<()> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            client.mark_read(&session_id, None).await.map_err(crate::runtime::request_error)?;
            Ok(())
        })
    }
}

fn project_states(states: Vec<SessionRunState>, activity: &[String]) -> Vec<Value> {
    // The UI supplies display membership and order; every session fact still comes from Runtime.
    let mut by_id: HashMap<_, _> = states.into_iter().map(|state| (state.session_id.clone(), state)).collect();
    activity
        .iter()
        .filter_map(|id| by_id.remove(id))
        .map(|state| {
            let mut state = serde_json::to_value(state).expect("serialize Runtime state");
            state["windowLabel"] = state["owner"].clone();
            state
        })
        .collect()
}
/// One registry per Runtime event subscription. IDs are JSON encoded to preserve the distinction
/// between string and numeric JSON-RPC IDs, exactly as in the chat client's action store.
const LEGACY_BUDGET: u32 = 2 * 1024 * 1024;

fn encoded_line_bytes(line: &str) -> Result<u32, String> {
    let size = serde_json::to_vec(line).map_err(|error| error.to_string())?.len() + 1;
    u32::try_from(size).map_err(|_| "Legacy replay exceeds budget".into())
}

#[derive(Default)]
pub struct RuntimeActions {
    client: Weak<alwith_api::RuntimeClient>,
    pending: Arc<Mutex<ActionRequests>>,
}

impl RuntimeActions {
    pub fn bind(&mut self, client: &Arc<alwith_api::RuntimeClient>) -> Arc<Mutex<ActionRequests>> {
        self.client = Arc::downgrade(client);
        self.pending = Arc::default();
        self.pending.clone()
    }
    fn permissions(
        &self, client: &Arc<alwith_api::RuntimeClient>, session: &str, remaining: u32,
    ) -> Result<Vec<String>, String> {
        if !self.client.ptr_eq(&Arc::downgrade(client)) || client.closed().is_some() {
            return Err("Runtime changed while reading mobile history".into());
        }
        self.pending.lock().unwrap().legacy_permissions(session, remaining)
    }
}

// Keep arrival order for older clients that replay original ACP requests. An oversized
// permission retains its identity and a budget error, without retaining its body.
struct PendingAction {
    key: String,
    permission: Option<(String, Option<String>)>,
}
#[derive(Default)]
pub struct ActionRequests(Vec<PendingAction>);

impl ActionRequests {
    fn observe(&mut self, event: &RuntimeEvent) -> Option<(&'static str, String)> {
        match event {
            RuntimeEvent::AcpAgentRequest { agent_id, id, method, params, .. }
                if agent_id == "codex"
                    && matches!(method.as_str(), "session/request_permission" | "elicitation/create") =>
            {
                let key = id.to_string();
                if self.0.iter().any(|entry| entry.key == key) {
                    return None;
                }
                let permission = (method == "session/request_permission").then(|| {
                    let session = params["sessionId"].as_str().unwrap_or_default().to_owned();
                    let line = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string();
                    let used: usize =
                        self.0.iter().filter_map(|entry| entry.permission.as_ref()?.1.as_ref()).map(String::len).sum();
                    let retained = (used.saturating_add(line.len()) <= LEGACY_BUDGET as usize).then_some(line);
                    (session, retained)
                });
                self.0.push(PendingAction { key: key.clone(), permission });
                Some(("mobile:action-opened", key))
            }
            RuntimeEvent::Outbound { agent_id, line, .. } if agent_id == "codex" && !self.0.is_empty() => {
                let frame: Value = serde_json::from_str(line).ok()?;
                if frame.get("method").is_some() || (frame.get("result").is_none() && frame.get("error").is_none()) {
                    return None;
                }
                let key = frame.get("id")?.to_string();
                let index = self.0.iter().position(|entry| entry.key == key)?;
                self.0.remove(index);
                Some(("mobile:action-resolved", key))
            }
            _ => None,
        }
    }

    fn legacy_permissions(&self, session: &str, mut remaining: u32) -> Result<Vec<String>, String> {
        let mut lines = Vec::new();
        for entry in &self.0 {
            let Some((id, line)) = &entry.permission else { continue };
            if id != session {
                continue;
            }
            let line = line.as_ref().ok_or("Legacy permission exceeds replay budget")?;
            remaining =
                remaining.checked_sub(encoded_line_bytes(line)?).ok_or("Legacy permissions exceed replay budget")?;
            lines.push(line.clone());
        }
        Ok(lines)
    }

    fn emit(app: &AppHandle, name: &str, key: String) {
        if let Err(error) = app.emit_to("main", name, json!({"actionId": key})) {
            log::error!("Cannot publish mobile action identity: {error}");
        }
    }

    pub fn close(&mut self, app: &AppHandle) {
        for entry in self.0.drain(..) {
            Self::emit(app, "mobile:action-resolved", entry.key);
        }
    }
}

pub fn publish(app: &AppHandle, event: &RuntimeEvent, pending: &Mutex<ActionRequests>) {
    let mut actions = pending.lock().unwrap();
    if matches!(event, RuntimeEvent::Exit { agent_id } if agent_id == "codex") {
        actions.close(app);
    } else if let Some((name, key)) = actions.observe(event) {
        ActionRequests::emit(app, name, key);
    }
    drop(actions);
    let mobile = app.mobile();
    let result = match event {
        RuntimeEvent::RunStates { sessions } => mobile.publish_run_states(&project_snapshot(sessions.clone())),
        // ACP notifications are the confirmed conversation stream. Publishing outbound prompts
        // as well would display both the request and its user_message echo on the phone.
        RuntimeEvent::AcpNotification { agent_id, method, params, .. }
            if method == "session/update" && !params["update"]["_meta"]["replay"]["id"].is_string() =>
        {
            let line = json!({"jsonrpc":"2.0", "method":method, "params":params}).to_string();
            mobile.publish_session_lines(agent_id, &[line])
        }
        RuntimeEvent::AcpAgentRequest { agent_id, id, method, params, .. }
            if method == "session/request_permission" =>
        {
            let line = json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}).to_string();
            mobile.publish_session_lines(agent_id, &[line])
        }
        _ => Ok(()),
    };
    if let Err(error) = result {
        log::error!("Mobile publication failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_supports_paged_history_and_session_actions() {
        assert!(Host.supports_session_history_and_actions());
        assert!(Host.supports_action_status());
        assert!(Host.supports_large_history_content_ranges());
    }

    #[test]
    fn correlates_only_original_codex_actions_and_forwards_no_answer_body() {
        let mut actions = ActionRequests::default();
        let open = |agent: &str, method: &str, id: Value| RuntimeEvent::AcpAgentRequest {
            agent_id: agent.into(),
            method: method.into(),
            id,
            params: json!({}),
            session_id: None,
            sequence: None,
        };
        let out = |agent: &str, frame: Value| RuntimeEvent::Outbound {
            agent_id: agent.into(),
            line: frame.to_string(),
            session_id: None,
            sequence: None,
        };
        assert_eq!(actions.observe(&open("other", "elicitation/create", json!(4))), None);
        assert_eq!(actions.observe(&open("codex", "fs/read_text_file", json!(4))), None);
        for (id, kind) in [(json!(4), "session/request_permission"), (json!("4"), "elicitation/create")] {
            assert_eq!(
                actions.observe(&open("codex", kind, id.clone())),
                Some(("mobile:action-opened", id.to_string()))
            );
        }
        assert_eq!(actions.observe(&out("other", json!({"id":4,"result":{}}))), None);
        assert_eq!(actions.observe(&out("codex", json!({"id":4,"method":"session/prompt","params":{}}))), None);
        for (id, body) in [
            (json!(4), json!({"id":4,"result":{"content":"private"}})),
            (json!("4"), json!({"id":"4","error":{"message":"private"}})),
        ] {
            assert_eq!(actions.observe(&out("codex", body.clone())), Some(("mobile:action-resolved", id.to_string())));
            assert_eq!(actions.observe(&out("codex", body)), None);
            assert_eq!(
                actions.observe(&open("codex", "elicitation/create", id.clone())),
                Some(("mobile:action-opened", id.to_string()))
            );
        }
    }

    #[test]
    fn legacy_replay_appends_only_unanswered_permissions_in_arrival_order_and_within_remaining_budget() {
        let mut pending = ActionRequests::default();
        for (id, session, method) in [
            (1, "viewed", "session/request_permission"),
            (2, "other", "session/request_permission"),
            (3, "viewed", "elicitation/create"),
            (4, "viewed", "session/request_permission"),
            (5, "viewed", "session/request_permission"),
        ] {
            pending.observe(&RuntimeEvent::AcpAgentRequest {
                agent_id: "codex".into(),
                id: json!(id),
                method: method.into(),
                params: json!({"sessionId":session,"title":"Please confirm"}),
                session_id: Some(session.into()),
                sequence: None,
            });
        }
        pending.observe(&RuntimeEvent::Outbound {
            agent_id: "codex".into(),
            line: json!({"id":4,"result":{}}).to_string(),
            session_id: None,
            sequence: None,
        });
        let lines = pending.legacy_permissions("viewed", LEGACY_BUDGET).unwrap();
        let ids: Vec<_> = lines.iter().map(|line| serde_json::from_str::<Value>(line).unwrap()["id"].clone()).collect();
        assert_eq!(ids, vec![json!(1), json!(5)]);
        let exact: u32 = lines.iter().map(|line| encoded_line_bytes(line).unwrap()).sum();
        assert_eq!(pending.legacy_permissions("viewed", exact).unwrap(), lines);
        assert!(pending.legacy_permissions("viewed", exact - 1).is_err());
        assert!(pending.legacy_permissions("absent", 0).unwrap().is_empty());
    }

    #[test]
    fn projects_runtime_owner_without_changing_run_state_or_read_version() {
        let source = json!({
            "sessionId": "remote", "state": "done", "reusableDraft": false,
            "owner": "main", "cwd": "/repo", "title": "Remote", "since": 42,
            "tasks": [], "listeningPorts": [], "executionId": null, "executionRole": null,
            "lastActivityAt": 42, "version": 7, "interruption": null
        });
        let state: SessionRunState = serde_json::from_value(source.clone()).unwrap();
        let mut projection = Projection {
            activity: vec!["remote".into()],
            states: vec![state],
            question_tokens: HashMap::from([("remote".into(), HashMap::from([("item".into(), "token".into())]))]),
        };
        let projected = projection.snapshot();
        assert_eq!(projected[0]["questionTokens"], json!({"item":"token"}));
        projection.question_tokens.clear();
        assert!(projection.snapshot()[0].get("questionTokens").is_none());
        assert_eq!(projected[0]["windowLabel"], "main");
        for (key, value) in source.as_object().unwrap() {
            assert_eq!(&projected[0][key], value, "Runtime field changed: {key}");
        }
    }
    #[test]
    fn excludes_retired_drafts_but_keeps_active_and_unread_sessions() {
        let base = json!({
            "sessionId": "session", "state": "idle", "reusableDraft": true,
            "owner": "", "cwd": "/repo", "title": "", "since": 42,
            "tasks": [], "listeningPorts": [], "executionId": null, "executionRole": null,
            "lastActivityAt": 42, "version": 1, "interruption": null
        });
        let mut retired: SessionRunState = serde_json::from_value(base).unwrap();
        retired.owner_id = "stdio".into();
        let mut active = retired.clone();
        active.owner_id = "stdio".into();
        active.session_id = "active".into();
        let mut unread = retired.clone();
        unread.session_id = "unread".into();
        unread.reusable_draft = false;
        unread.state = alwith_api::RunState::Done;
        let projected =
            project_states(vec![retired, active, unread], &["unread".into(), "active".into(), "missing".into()]);
        assert_eq!(projected.len(), 2);
        assert_eq!(projected[0]["sessionId"], "unread");
        assert_eq!(projected[1]["sessionId"], "active");
        assert_eq!(projected[0]["state"], "done");
    }
}
