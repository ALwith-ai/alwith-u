use alwith_enterprise_client::{CatalogModel, EnterpriseClient, Protocol};
use serde_json::Value;
use std::path::PathBuf;

#[test]
fn enterprise_native_preserves_generation_and_owner_lifecycle() {
    tauri::async_runtime::block_on(async {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/native");
        let storage = tempfile::tempdir().unwrap();
        let settings = storage.path().join("enterprise-settings.json");
        let client = EnterpriseClient::open(&directory, &settings).await.expect("stage enterprise before Rust tests");
        assert!(EnterpriseClient::open(&directory, &settings).await.is_err());
        let first = client
            .prepare("https://api-dev.alwith.ai/service".into(), "first-account".into(), "fake-token".into())
            .await
            .unwrap();
        assert_eq!(client.status(first).await.unwrap()["automatic_renewal"], false);
        let second = client
            .prepare("https://api-dev.alwith.ai/service".into(), "second-account".into(), "fake-token".into())
            .await
            .unwrap();
        assert_ne!(first, second);
        let error = client.status(first).await.unwrap_err();
        assert!(error.is_object());
        assert!(error["message"].is_string());
        assert!(!error.to_string().contains("fake-token"));
        assert!(client.relay(second, "https://gateway.example".into(), Protocol::Responses).await.is_err());
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@alwith/module-chat/assets/catalogs/alwith/models.json");
        let models = [
            CatalogModel {
                api_id: "deepseek-V4.1-flash".into(),
                label: "Enterprise model".into(),
                description: None,
                context_window: Some(120000),
            },
            CatalogModel {
                api_id: "issued/unknown".into(),
                label: "Unknown".into(),
                description: None,
                context_window: None,
            },
        ];
        let catalog = client.model_catalog(second, &source, &models).await.unwrap();
        assert!(catalog.has_known_model);
        let value: Value = serde_json::from_slice(&std::fs::read(&catalog.path).unwrap()).unwrap();
        assert_eq!(value["models"][0]["input_modalities"], serde_json::json!(["text", "image"]));
        assert_eq!(value["models"][0]["display_name"], "Enterprise model");
        assert_eq!(value["models"][0]["context_window"], 120000);
        assert_eq!(value["models"][1]["input_modalities"], serde_json::json!(["text"]));
        assert!(!value.to_string().contains("fake-token"));
        assert!(client.model_catalog(first, &source, &models).await.is_err());
        client.suspend(second).await.unwrap();
        // A pending native event read must not prevent the application from closing its owner.
        let reader = client.clone();
        let events = tauri::async_runtime::spawn(async move { reader.next_event().await });
        client.close().await.unwrap();
        assert!(!catalog.path.exists());
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), events).await.unwrap().unwrap();
        // Reads admitted before close return null; later reads reject the retired handle.
        assert!(result == Ok(Value::Null) || result.unwrap_err()["message"].is_string());
        assert!(client.status(second).await.is_err());
        let reopened = EnterpriseClient::open(&directory, &settings).await.unwrap();
        reopened.close().await.unwrap();
    });
}
