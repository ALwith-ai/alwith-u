//! The independent Runtime engine owns native history reads and all content splitting.
use alwith_api::{RuntimeClient, RuntimeEvent};
use alwith_mobile::SessionHistoryPage;
use serde_json::{Value, json};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::Duration;

pub const ENGINE: &str = "u-mobile-history";
static READY: Mutex<Weak<RuntimeClient>> = Mutex::new(Weak::new());
static STARTING: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

pub fn private_event(event: &RuntimeEvent) -> bool {
    let id = match event {
        RuntimeEvent::Exit { agent_id } if agent_id == ENGINE => {
            *READY.lock().unwrap() = Weak::new();
            return true;
        }
        RuntimeEvent::Wire { agent_id, .. }
        | RuntimeEvent::Inbound { agent_id, .. }
        | RuntimeEvent::Outbound { agent_id, .. }
        | RuntimeEvent::Stderr { agent_id, .. }
        | RuntimeEvent::AcpNotification { agent_id, .. }
        | RuntimeEvent::AcpAgentRequest { agent_id, .. } => agent_id,
        _ => return false,
    };
    id == ENGINE
}

async fn ensure(client: &Arc<RuntimeClient>) -> Result<(), String> {
    let _lock = STARTING.lock().await;
    if READY.lock().unwrap().ptr_eq(&Arc::downgrade(client)) {
        return Ok(());
    }
    if !client.agents().await.map_err(crate::runtime::request_error)?.iter().any(|a| a["agentId"] == ENGINE) {
        client.start(ENGINE, json!({"engine":ENGINE}), None).await.map_err(crate::runtime::request_error)?;
    }
    let reply = client.initialize(ENGINE, None, None, None).await.map_err(crate::runtime::request_error)?;
    if reply.pointer("/capabilities/_meta/mobileHistory") != Some(&json!(1)) {
        return Err("Incompatible mobile history worker".into());
    }
    *READY.lock().unwrap() = Arc::downgrade(client);
    Ok(())
}

pub async fn bounded<T>(work: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(Duration::from_secs(25), work).await.map_err(|_| "Mobile history timed out".to_string())?
}

pub async fn request(client: &Arc<RuntimeClient>, method: &'static str, params: Value) -> Result<Value, String> {
    ensure(client).await?;
    let id = json!(format!("mobile-history-{}", uuid::Uuid::new_v4()));
    let cancellation = client.clone();
    super::requests::run(
        id,
        |id| async move {
            client.acp_request(ENGINE, method, params, Some(id), None).await.map_err(crate::runtime::request_error)
        },
        move |id| {
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    cancellation.acp_notify(ENGINE, "$/cancel_request", json!({"requestId":id}), None).await
                {
                    log::debug!("History cancellation after request ended: {}", crate::runtime::request_error(error));
                }
            });
        },
    )
    .await
}

pub async fn page(
    client: &Arc<RuntimeClient>, session_id: &str, cursor: Option<&str>, max_bytes: u32,
) -> Result<SessionHistoryPage, String> {
    super::draft::read_page(
        session_id,
        cursor,
        || async { client.run_states().await.map_err(crate::runtime::request_error) },
        || async {
            let result = request(
                client,
                "_alwith/mobile_history_page",
                json!({"sessionId":session_id,"cursor":cursor,"maxBytes":max_bytes}),
            )
            .await?;
            if result["sessionId"] != session_id
                || serde_json::to_vec(&result).map_err(|error| error.to_string())?.len() > max_bytes as usize
            {
                return Err("Invalid mobile history response".into());
            }
            serde_json::from_value(result).map_err(|error| error.to_string())
        },
    )
    .await
}
