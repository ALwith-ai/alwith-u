use super::*;
use std::io::{Read, Write};

fn mock_response(body: serde_json::Value) -> (String, std::thread::JoinHandle<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..end]);
                let length = header
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let body = serde_json::to_vec(&body).unwrap();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        stream.write_all(&body).unwrap();
        String::from_utf8(bytes).unwrap()
    });
    (base, worker)
}

#[tokio::test]
async fn both_minimax_models_route_generation_and_editing_with_the_selected_area() {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=";
    for model in ["MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"] {
        for editing in [false, true] {
            let (base, worker) = mock_response(json!({"data": [{"b64_json": png}]}));
            let input = ImageInput {
                request_id: "minimax-test".into(),
                model: model.into(),
                size: "4K".into(),
                prompt: "A blue tree".into(),
                images: if editing { vec![format!("data:image/png;base64,{png}")] } else { vec![] },
            };
            let result = generate(&input, false, "test-key", &base).await.unwrap();
            assert_eq!(result.images[0].mime_type, "image/png");
            assert_eq!(result.images[0].data, png);
            let request = worker.join().unwrap();
            assert!(request.starts_with(if editing { "POST /images/edits " } else { "POST /images/generations " }));
            let (_, body) = request.split_once("\r\n\r\n").unwrap();
            let body: serde_json::Value = serde_json::from_str(body).unwrap();
            assert_eq!(body["model"], model);
            assert_eq!(body["area"], "4K");
            assert_eq!(body["size"], "auto");
            assert_eq!(body["n"], 1);
            assert_eq!(body["output_format"], "png");
            assert!(body.get("watermark").is_none());
            assert!(body.get("image").is_none());
            if editing {
                assert_eq!(body["images"][0]["image_url"], input.images[0]);
            } else {
                assert!(body.get("images").is_none());
            }
        }
    }
}

#[tokio::test]
async fn minimax_item_failure_is_reported_without_exposing_credentials_or_retrying() {
    let (base, worker) = mock_response(json!({"data": [{"error": {"message": "Rejected test-key"}}]}));
    let input = ImageInput {
        request_id: "failure".into(),
        model: "MiniMax-H3-Image".into(),
        size: "2K".into(),
        prompt: "A tree".into(),
        images: vec![],
    };
    let error = generate(&input, false, "test-key", &base).await.err().unwrap();
    assert_eq!(error, "Rejected [redacted]");
    worker.join().unwrap();
}

#[test]
fn minimax_validates_model_resolution_reference_count_and_unicode_prompt_length() {
    let mut input = ImageInput {
        request_id: "validate".into(),
        model: "MiniMax-H3-Image-Highspeed".into(),
        size: "1K".into(),
        prompt: "树".repeat(32000),
        images: vec![],
    };
    assert!(validate(&input).is_ok());
    input.prompt.push('树');
    assert!(validate(&input).is_err());
    input.prompt = "A tree".into();
    input.size = "3K".into();
    assert!(validate(&input).is_err());
    input.size = "2K".into();
    input.images = vec![String::new(); 17];
    assert!(validate(&input).is_err());
}

#[test]
fn minimax_regions_persist_and_route_both_models_without_changing_custom_endpoints() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SettingsStore::load(dir.path().into()).unwrap();
    assert_eq!(effective_base_url(&store, ImageProvider::Minimax).unwrap(), "https://api.minimax.cn/v1");
    for (region, endpoint) in [("intl", "https://api.minimax.io/v1"), ("cn", "https://api.minimax.cn/v1")] {
        let revision = store.snapshot().unwrap().0;
        store.save_image_provider_for("minimax", "", Some("test-key"), revision, Some(region)).unwrap();
        let restored = SettingsStore::load(dir.path().into()).unwrap();
        assert_eq!(settings(&restored, ImageProvider::Minimax).unwrap().region.unwrap().key(), region);
        for model in ["MiniMax-H3-Image", "MiniMax-H3-Image-Highspeed"] {
            assert_eq!(effective_base_url(&restored, model_provider(model).unwrap()).unwrap(), endpoint);
        }
    }
    let revision = store.snapshot().unwrap().0;
    assert!(store.save_image_provider_for("minimax", "", None, revision, Some("invalid")).is_err());
    store.save_image_provider_for("minimax", "https://custom.example/v1", None, revision, Some("intl")).unwrap();
    assert_eq!(effective_base_url(&store, ImageProvider::Minimax).unwrap(), "https://custom.example/v1");
}
