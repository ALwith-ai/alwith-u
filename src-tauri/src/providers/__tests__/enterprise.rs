use alwith_enterprise_core::{Host, Protocol};

#[tokio::test]
async fn git_source_host_runs_without_a_native_enterprise_library() {
    let directory = tempfile::tempdir().unwrap();
    let host = Host::new(directory.path().join("enterprise-settings.json"));
    let generation = host
        .prepare("https://api-dev.alwith.ai/service".into(), "isolated-account".into(), "fake-token".into())
        .await
        .unwrap();
    let status = host.status(generation).await.unwrap();
    assert_eq!(status["automatic_renewal"], false);
    assert_eq!(status["generation"], generation);
    assert_eq!(Protocol::Responses.api_base("http://127.0.0.1:1234"), "http://127.0.0.1:1234/v1");
    host.suspend(generation).await.unwrap();
    let replacement = host
        .prepare("https://api-dev.alwith.ai/service".into(), "isolated-account".into(), "fake-token".into())
        .await
        .unwrap();
    assert_ne!(generation, replacement);
    assert!(host.status(generation).await.is_err());
    host.close().await.unwrap();
    assert!(host.status(replacement).await.is_err());
}
