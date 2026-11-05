//! U's Gamepad policy around the shared plugin: the Gamepad window's temporary AI agents live in
//! U's Runtime, so U configures and stops them. Engine, capture and permissions are the plugin's.
use serde_json::Value;
use tauri::Manager;

fn authorize(label: &str) -> Result<(), String> {
    if matches!(label, "main" | "settings" | "gamepad") {
        Ok(())
    } else {
        Err("Gamepad AI is unavailable in this window".into())
    }
}

fn is_temporary_agent(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("gamepad-config-") else {
        return false;
    };
    suffix.len() == 36
        && suffix.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) { byte == b'-' } else { byte.is_ascii_hexdigit() }
        })
}

/// Configure only a newly created Gamepad agent; credentials never leave the native host.
#[tauri3_specta::command]
pub async fn gamepad_ai_prepare(window: tauri::WebviewWindow, agent_id: String) -> Result<(), String> {
    authorize(window.label())?;
    if !is_temporary_agent(&agent_id) {
        return Err("Invalid Gamepad AI agent".into());
    }
    alwith_chat::prepare_agent(window.app_handle(), &agent_id).await?;
    let runtime = window.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    let client = runtime.current()?;
    crate::enterprise::ready(window.app_handle(), &agent_id);
    crate::enterprise::apply(window.app_handle(), &client, &agent_id).await
}

/// The destroyed Gamepad window cannot stop its temporary agents itself.
pub fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    if label != "gamepad" {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<crate::runtime::RuntimeState>();
        let client = match runtime.current() {
            Ok(client) => client,
            Err(error) => {
                log::error!("Cannot access Runtime for Gamepad teardown: {error}");
                return;
            }
        };
        let agents = match client.agents().await {
            Ok(agents) => agents,
            Err(error) => {
                log::error!("Cannot list Gamepad temporary agents: {}", crate::runtime::request_error(error));
                return;
            }
        };
        for agent in agents {
            if let Some(id) = agent.get("agentId").and_then(Value::as_str).filter(|id| is_temporary_agent(id))
                && let Err(error) = client.stop(id, None).await
            {
                log::error!("Cannot stop Gamepad temporary agent {id}: {}", crate::runtime::request_error(error));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{authorize, is_temporary_agent};

    #[test]
    fn destroyed_window_targets_only_valid_gamepad_agents() {
        assert!(is_temporary_agent("gamepad-config-00000000-0000-4000-8000-000000000000"));
        for id in [
            "codex",
            "gamepad-config-test",
            "gamepad-config-000000000000000000000000000000000000",
            "chat-00000000-0000-4000-8000-000000000000",
        ] {
            assert!(!is_temporary_agent(id), "must preserve {id}");
        }
    }

    #[test]
    fn only_application_windows_can_prepare_gamepad_ai() {
        for label in ["main", "settings", "gamepad"] {
            assert!(authorize(label).is_ok());
        }
        assert!(authorize("untrusted").is_err());
    }
}
