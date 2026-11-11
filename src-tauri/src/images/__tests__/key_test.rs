use super::*;
use std::io::{Read, Write};

async fn verify(provider: ImageProvider, status: u16, body: serde_json::Value) -> ImageKeyTestResult {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        let mut request = Vec::new();
        loop {
            let mut buffer = [0; 2048];
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            if request.windows(4).any(|part| part == b"\r\n\r\n") {
                break;
            }
        }
        let body = body.to_string();
        write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nLocation: /images/generations\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        String::from_utf8(request).unwrap()
    });
    let result = probe(provider, "test-private-key", &base).await;
    let request = worker.join().unwrap();
    let path = match provider {
        ImageProvider::Seedream => "/v1/models",
        ImageProvider::Minimax => "/v1/files/list?purpose=image_generation_input",
    };
    assert!(request.starts_with(&format!("GET {path} HTTP/1.1\r\n")));
    assert!(request.to_lowercase().contains("authorization: bearer test-private-key\r\n"));
    assert!(!request.contains("prompt"));
    assert!(request.ends_with("\r\n\r\n"));
    result
}

#[tokio::test]
async fn verifies_credentials_with_one_read_only_authenticated_request() {
    assert!(verify(ImageProvider::Seedream, 200, json!({"data":[]})).await.ok);
    assert!(verify(ImageProvider::Minimax, 200, json!({"files":[],"base_resp":{"status_code":0}})).await.ok);
}

#[tokio::test]
async fn does_not_mistake_http_success_for_valid_minimax_credentials() {
    for code in [1004, 2049] {
        let result = verify(ImageProvider::Minimax, 200, json!({"base_resp":{"status_code":code}})).await;
        assert!(!result.ok);
        assert_eq!(result.code, "unauthorized");
    }
    for body in [json!({}), json!({"files":[]}), json!({"files":[],"base_resp":{"status_code":2013}})] {
        assert!(!verify(ImageProvider::Minimax, 200, body).await.ok);
    }
    assert!(!verify(ImageProvider::Seedream, 200, json!({"error":{"message":"bad key"}})).await.ok);
}

#[tokio::test]
async fn distinguishes_auth_permissions_unsupported_and_transient_failures_without_generation_fallback() {
    for (status, code) in [
        (401, "unauthorized"),
        (403, "forbidden"),
        (404, "verification_unsupported"),
        (405, "verification_unsupported"),
        (429, "rate_limited"),
        (503, "server_error"),
        (302, "request_rejected"),
    ] {
        let result = verify(ImageProvider::Minimax, status, json!({})).await;
        assert!(!result.ok);
        assert_eq!(result.code, code);
    }
}
