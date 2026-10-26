//! U supplies Runtime facts; the shared module owns pairing and mobile transport.
use alwith_api::{RuntimeEvent, SessionRunState};
pub use alwith_mobile::host::*;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let host = app.clone();
    alwith_mobile::host::init(app, alwith_mobile::HostApp::U, move |method, params| {
        let app = host.clone();
        Box::pin(async move {
            let client = app.state::<crate::runtime::RuntimeState>().current()?;
            let session_id = || params["sessionId"].as_str().ok_or_else(|| "Missing mobile sessionId".to_string());
            match method.as_str() {
                "runStates" => Ok(project_states(client.run_states().await.map_err(crate::runtime::request_error)?)),
                "agentForSession" => {
                    Ok(json!(client.agent_for_session(session_id()?).await.map_err(crate::runtime::request_error)?))
                }
                "sessionReplay" => {
                    Ok(json!(client.session_replay(session_id()?).await.map_err(crate::runtime::request_error)?))
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
fn project_states(states: Vec<SessionRunState>) -> Value {
    let mut states = serde_json::to_value(states).expect("serialize Runtime states");
    for state in states.as_array_mut().expect("Runtime state list") {
        state["windowLabel"] = state["owner"].clone();
    }
    states
}
pub fn publish(event: &RuntimeEvent) {
    match event {
        RuntimeEvent::RunStates { sessions } => publish_run_states(project_states(sessions.clone()).to_string()),
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
        let projected = project_states(vec![state]);
        assert_eq!(projected[0]["windowLabel"], "main");
        for (key, value) in source.as_object().unwrap() {
            assert_eq!(&projected[0][key], value, "Runtime field changed: {key}");
        }
    }
}
