use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

fn gamepad_request(method: &str, agent_id: &str) -> Request {
    serde_json::from_value(
        json!({ "id": 1, "method": "acpRequest", "params": { "agentId": agent_id, "method": method, "params": {} } }),
    )
    .unwrap()
}

#[test]
fn only_dedicated_gamepad_creation_and_prompt_skip_main_catalog_admission() {
    let id = "gamepad-config-12345678-1234-1234-1234-123456789abc";
    for method in ["session/new", "session/prompt"] {
        let request = gamepad_request(method, id);
        assert!(is_admission(&request), "the admission lock must remain held");
        assert_eq!(gamepad_admission_target("gamepad", &request), Some(id));
        for sender in ["main", "settings", "chat", "untrusted"] {
            assert_eq!(gamepad_admission_target(sender, &request), None);
        }
        assert_eq!(gamepad_admission_target("gamepad", &gamepad_request(method, "codex")), None);
        assert_eq!(gamepad_admission_target("gamepad", &gamepad_request(method, "gamepad-config-invalid")), None);
        assert_eq!(
            gamepad_admission_target(
                "gamepad",
                &gamepad_request(method, "gamepad-config-------------------------------------")
            ),
            None
        );
    }
    for method in ["session/resume", "session/fork", "session/load", "providers/set"] {
        assert_eq!(gamepad_admission_target("gamepad", &gamepad_request(method, id)), None);
    }
    let start: Request =
        serde_json::from_value(json!({"id": 1, "method": "start", "params": {"agentId": id}})).unwrap();
    assert!(!is_admission(&start));
    assert_eq!(gamepad_admission_target("gamepad", &start), None);
}

#[test]
fn shutdown_keeps_the_executor_available_until_the_peer_closes() {
    tauri::async_runtime::block_on(async {
        let state = RuntimeState::default();
        let (reader, mut peer_writer) = tokio::io::duplex(1024);
        let (peer_reader, writer) = tokio::io::duplex(1024);
        *state.client.lock().unwrap() = Some(Arc::new(RuntimeClient::over(reader, writer)));
        assert!(state.begin_shutdown());
        assert!(!state.begin_shutdown(), "repeated quit must not start a second shutdown");
        assert_eq!(state.current().err().as_deref(), Some("Application is closing"));

        // This peer runs on the same executor as shutdown, representing work that the
        // native event loop must remain available to service during a quit request.
        let peer = async {
            let mut lines = BufReader::new(peer_reader).lines();
            let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(request["method"], "shutdown");
            assert!(!state.shutdown_complete.load(Ordering::Acquire));
            let reply = json!({"id": request["id"], "result": null, "error": null});
            peer_writer.write_all(format!("{reply}\n").as_bytes()).await.unwrap();
            peer_writer.shutdown().await.unwrap();
        };
        tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(state.shutdown(), peer);
        })
        .await
        .expect("shutdown must let the peer progress");
        assert!(state.shutdown_complete.load(Ordering::Acquire));
        assert!(state.client.lock().unwrap().is_none());
    });
}

#[test]
fn shutdown_cancels_startup_and_waits_for_its_lock() {
    tauri::async_runtime::block_on(async {
        let state = RuntimeState::default();
        let starting = state.starting.lock().await;
        let notified = state.close_signal.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        assert!(state.begin_shutdown());
        tokio::time::timeout(Duration::from_secs(1), notified).await.expect("startup must be notified");
        let shutdown = state.shutdown();
        tokio::pin!(shutdown);
        assert!(tokio::time::timeout(Duration::from_millis(10), &mut shutdown).await.is_err());
        assert!(!state.shutdown_complete.load(Ordering::Acquire));
        drop(starting);
        tokio::time::timeout(Duration::from_secs(1), shutdown).await.expect("startup has released its lock");
        assert!(state.shutdown_complete.load(Ordering::Acquire));
    });
}

#[test]
fn an_unresponsive_peer_cannot_prevent_shutdown_completion() {
    tauri::async_runtime::block_on(async {
        let state = RuntimeState::default();
        let (reader, _peer_writer) = tokio::io::duplex(1024);
        let (_peer_reader, writer) = tokio::io::duplex(1024);
        *state.client.lock().unwrap() = Some(Arc::new(RuntimeClient::over(reader, writer)));
        assert!(state.begin_shutdown());
        tokio::time::timeout(SHUTDOWN_GRACE + Duration::from_secs(1), state.shutdown())
            .await
            .expect("an unresponsive peer must be bounded by the grace period");
        assert!(state.shutdown_complete.load(Ordering::Acquire));
        assert!(state.client.lock().unwrap().is_none());
    });
}
