use alwith_enterprise_client::{EnterpriseClient, GATEWAY_URL, Protocol};
use serde_json::Value;
use std::{collections::BTreeMap, path::PathBuf};

#[test]
fn gateway_sessions_do_not_read_legacy_credentials_and_isolate_account_environments() {
    tauri::async_runtime::block_on(async {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native");
        let storage = tempfile::tempdir().unwrap();
        let legacy = storage.path().join("enterprise-renewal.json");
        std::fs::write(&legacy, "legacy credentials must not be opened by gateway sessions").unwrap();
        let sessions = storage.path().join("enterprise-gateway-sessions.json");
        let client = EnterpriseClient::open_gateway(&directory, &sessions).await.unwrap();
        let prepare = |environment: &str| {
            client.prepare_gateway(
                GATEWAY_URL.into(),
                "same-account".into(),
                "alwith@example.test".into(),
                environment.into(),
                "alwith-u".into(),
            )
        };
        let first = prepare("production").await.unwrap();
        let status = client.ensure(first).await.unwrap();
        assert_eq!(status["requires_login"], true);
        assert_eq!(status["automatic_renewal"], false);
        let second = prepare("development").await.unwrap();
        assert_ne!(first, second);
        assert!(client.status(first).await.is_err());
        client.suspend(second).await.unwrap();
        client.close().await.unwrap();
        assert_eq!(
            std::fs::read_to_string(legacy).unwrap(),
            "legacy credentials must not be opened by gateway sessions"
        );
    });
}

#[test]
fn enterprise_native_preserves_generation_and_owner_lifecycle() {
    tauri::async_runtime::block_on(async {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native");
        let storage = tempfile::tempdir().unwrap();
        let sessions = storage.path().join("enterprise-gateway-sessions.json");
        let client =
            EnterpriseClient::open_gateway(&directory, &sessions).await.expect("stage enterprise before Rust tests");
        assert!(EnterpriseClient::open_gateway(&directory, &sessions).await.is_err());
        let prepare = |account: &str| {
            client.prepare_gateway(
                GATEWAY_URL.into(),
                account.into(),
                "alwith@example.test".into(),
                "development".into(),
                "alwith-u".into(),
            )
        };
        let first = prepare("first-account").await.unwrap();
        let second = prepare("second-account").await.unwrap();
        assert_ne!(first, second);
        let error = client.status(first).await.unwrap_err();
        assert!(error["message"].is_string());
        // Without a renewable session there is nothing to connect.
        let labels = BTreeMap::new();
        assert!(client.connect(second, &labels, Protocol::Responses, None).await.unwrap().is_none());
        assert!(client.connect(first, &labels, Protocol::Responses, None).await.is_err());
        client.suspend(second).await.unwrap();
        // A pending native event read must not prevent the application from closing its owner.
        let reader = client.clone();
        let events = tauri::async_runtime::spawn(async move { reader.next_event().await });
        client.close().await.unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), events).await.unwrap().unwrap();
        // Reads admitted before close return null; later reads reject the retired handle.
        assert!(result == Ok(Value::Null) || result.unwrap_err()["message"].is_string());
        assert!(client.status(second).await.is_err());
        let reopened = EnterpriseClient::open_gateway(&directory, &sessions).await.unwrap();
        reopened.close().await.unwrap();
    });
}
