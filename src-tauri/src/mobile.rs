//! U supplies Runtime facts; the shared module owns pairing and mobile transport.
use alwith_api::{RuntimeEvent, SessionRunState};
pub use alwith_mobile::host::*;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Manager};
mod history;

#[derive(Default)]
struct Projection {
    drafts: HashSet<String>,
    states: Vec<SessionRunState>,
}
static PROJECTION: LazyLock<Mutex<Projection>> = LazyLock::new(|| Mutex::new(Projection::default()));

#[tauri3_specta::command]
pub fn mobile_set_draft_sessions(session_ids: Vec<String>) {
    let mut projection = PROJECTION.lock().unwrap();
    projection.drafts = session_ids.into_iter().collect();
    publish_run_states(project_states(projection.states.clone(), &projection.drafts).to_string());
}

fn project_snapshot(states: Vec<SessionRunState>) -> Value {
    let mut projection = PROJECTION.lock().unwrap();
    projection.states = states;
    project_states(projection.states.clone(), &projection.drafts)
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let host = app.clone();
    alwith_mobile::host::init(app, alwith_mobile::HostApp::U, move |method, params| {
        let app = host.clone();
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            let session_id = || params["sessionId"].as_str().ok_or_else(|| "Missing mobile sessionId".to_string());
            match method.as_str() {
                "runStates" => Ok(project_snapshot(client.run_states().await.map_err(crate::runtime::request_error)?)),
                "agentForSession" => {
                    // U's conversations belong to its Codex adapter, including retained activity
                    // whose Runtime attachment has ended. Reading history must not resume or select it.
                    session_id()?;
                    Ok(json!("codex"))
                }
                "sessionReplay" => {
                    let id = session_id()?;
                    let mut lines = history::read(id, |params| {
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
                    let replay = client.session_replay(id).await.map_err(crate::runtime::request_error)?;
                    lines.extend(history::pending_permissions(id, replay)?);
                    Ok(json!(lines))
                }
                "markRead" => {
                    client.mark_read(session_id()?, None).await.map_err(crate::runtime::request_error)?;
                    Ok(Value::Null)
                }
                _ => Err(format!("Unknown mobile host request: {method}")),
            }
        })
    })
}
fn project_states(states: Vec<SessionRunState>, drafts: &HashSet<String>) -> Value {
    // Use the same draft membership as the Activity panel; Runtime attachment can outlive a UI draft.
    let states: Vec<_> =
        states.into_iter().filter(|state| !state.reusable_draft || drafts.contains(&state.session_id)).collect();
    let mut states = serde_json::to_value(states).expect("serialize Runtime states");
    for state in states.as_array_mut().expect("Runtime state list") {
        state["windowLabel"] = state["owner"].clone();
    }
    states
}
pub fn publish(event: &RuntimeEvent) {
    match event {
        RuntimeEvent::RunStates { sessions } => publish_run_states(project_snapshot(sessions.clone()).to_string()),
        RuntimeEvent::Inbound { agent_id, lines } => publish_session_lines(agent_id.clone(), json!(lines).to_string()),
        RuntimeEvent::Outbound { agent_id, line, .. } => {
            publish_session_lines(agent_id.clone(), json!([line]).to_string())
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_mobile_library_preserves_identity_and_rejects_offline_pairing() {
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/native");
        alwith_native_client::configure(&directory).unwrap();
        let storage = tempfile::tempdir().unwrap();
        let mobile = alwith_mobile::Mobile::new(storage.path(), alwith_mobile::HostApp::U).unwrap();
        let status: alwith_mobile::MobileBridgeStatus = mobile.call("status", json!({})).unwrap();
        assert!(!status.running);
        assert_eq!(mobile.call::<Value>("pairing", json!({})).unwrap_err(), "relay disconnected");
        let identity: alwith_mobile::BridgeIdentity = mobile.call("identity", json!({})).unwrap();
        assert!(!identity.device_id.is_empty());
        assert!(!identity.public_key_b64.is_empty());
        let again: alwith_mobile::BridgeIdentity = mobile.call("identity", json!({})).unwrap();
        assert_eq!(identity.device_id, again.device_id);
        mobile.close().unwrap();
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
        let projected = project_states(vec![state], &HashSet::new());
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
        let projected = project_states(vec![retired, active, unread], &HashSet::from(["active".into()]));
        assert_eq!(projected.as_array().unwrap().len(), 2);
        assert_eq!(projected[0]["sessionId"], "active");
        assert_eq!(projected[1]["sessionId"], "unread");
        assert_eq!(projected[1]["state"], "done");
    }
}
