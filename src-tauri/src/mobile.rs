//! U supplies Runtime facts; the shared mobile plugin owns pairing and transport.
use alwith_api::{RuntimeEvent, SessionRunState};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Manager};
use alwith_mobile::{HostFuture, MobileExt, MobileHost};
mod history;

#[derive(Default)]
struct Projection {
    activity: Vec<String>,
    states: Vec<SessionRunState>,
}
static PROJECTION: LazyLock<Mutex<Projection>> = LazyLock::new(|| Mutex::new(Projection::default()));

#[tauri3_specta::command]
pub fn mobile_set_activity_sessions(app: AppHandle, session_ids: Vec<String>) -> Result<(), String> {
    let states = {
        let mut projection = PROJECTION.lock().unwrap();
        projection.activity = session_ids;
        project_states(projection.states.clone(), &projection.activity)
    };
    app.mobile().publish_run_states(&states).map_err(|error| error.message)
}

fn project_snapshot(states: Vec<SessionRunState>) -> Vec<Value> {
    let mut projection = PROJECTION.lock().unwrap();
    projection.states = states;
    project_states(projection.states.clone(), &projection.activity)
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
    fn session_replay(&self, app: AppHandle, session_id: String) -> HostFuture<Vec<String>> {
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            let mut lines = history::read(&session_id, |params| {
                let client = client.clone();
                async move {
                    client
                        .acp_request("codex", "_codex/session_history", params, None, None)
                        .await
                        .map_err(crate::runtime::request_error)
                }
            })
            .await?;
            // Fetch after history so pending permissions reflect the latest Runtime snapshot.
            let replay = client.session_replay(&session_id).await.map_err(crate::runtime::request_error)?;
            lines.extend(history::pending_permissions(&session_id, replay)?);
            Ok(lines)
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
pub fn publish(app: &AppHandle, event: &RuntimeEvent) {
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
    fn projects_runtime_owner_without_changing_run_state_or_read_version() {
        let source = json!({
            "sessionId": "remote", "state": "done", "reusableDraft": false,
            "owner": "main", "cwd": "/repo", "title": "Remote", "since": 42,
            "tasks": [], "listeningPorts": [], "executionId": null, "executionRole": null,
            "lastActivityAt": 42, "version": 7, "interruption": null
        });
        let state: SessionRunState = serde_json::from_value(source.clone()).unwrap();
        let projected = project_states(vec![state], &["remote".into()]);
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
