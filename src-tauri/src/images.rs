//! Image provider requests use native credentials and return media through the ACP client tool.
use crate::settings::SharedSettings;
use crate::settings_store::SettingsStore;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
use tauri::State;
mod references;
pub use references::ImageReferencesInput;

type Requests = BTreeMap<(String, String), tokio::sync::watch::Sender<bool>>;
static REQUESTS: OnceLock<Mutex<Requests>> = OnceLock::new();
const DEFAULT_BASE_URL: &str = "https://ark.cn-beijing.volces.com/api/v3";
const MAX_MEDIA_BYTES: usize = 15 * 1024 * 1024;
fn requests() -> &'static Mutex<Requests> {
    REQUESTS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

#[tauri3_specta::command]
pub fn images_cancel(window: tauri::Window, request_id: String) -> Result<(), String> {
    check(&window)?;
    if let Some(sender) =
        requests().lock().map_err(|_| "Image request lock poisoned")?.get(&(window.label().into(), request_id))
    {
        let _ = sender.send(true);
    }
    Ok(())
}

fn check(window: &tauri::Window) -> Result<(), String> {
    if matches!(window.label(), "main" | "settings" | "chat") { Ok(()) } else { Err("Image access denied".into()) }
}
#[tauri3_specta::command]
pub fn images_configured(window: tauri::Window, state: State<'_, SharedSettings>) -> Result<bool, String> {
    check(&window)?;
    Ok(state.0.lock().map_err(|_| "Settings lock poisoned")?.secret("images.seedream.apiKey")?.is_some())
}
#[tauri3_specta::command]
pub fn images_read_settings(window: tauri::Window, state: State<'_, SharedSettings>) -> Result<ImageSettings, String> {
    check(&window)?;
    let store = state.0.lock().map_err(|_| "Settings lock poisoned")?;
    settings(&store)
}
#[tauri3_specta::command]
pub fn images_save_settings(
    window: tauri::Window, state: State<'_, SharedSettings>, input: ImageSettingsInput,
) -> Result<ImageSettings, String> {
    check(&window)?;
    let base_url = normalize_base_url(&input.base_url)?;
    let mut store = state.0.lock().map_err(|_| "Settings lock poisoned")?;
    store.save_image_provider(&base_url, input.api_key.as_deref().map(str::trim), input.expected_revision)?;
    settings(&store)
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageSettings {
    revision: u64,
    base_url: String,
    default_base_url: String,
    configured: bool,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageSettingsInput {
    expected_revision: u64,
    base_url: String,
    api_key: Option<String>,
}
fn normalize_base_url(value: &str) -> Result<String, String> {
    if value.len() > 2048 {
        return Err("Image API base URL is too long".into());
    }
    if value.trim().is_empty() {
        return Ok(String::new());
    }
    let mut url = reqwest::Url::parse(value.trim()).map_err(|_| "Invalid image API base URL")?;
    let local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1" | "[::1]"));
    if url.scheme() != "https" && !local_http {
        return Err("Image API base URL must use HTTPS (HTTP is allowed only for localhost)".into());
    }
    if url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Image API base URL cannot contain credentials, query parameters, or a fragment".into());
    }
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_owned())
}
fn settings(store: &SettingsStore) -> Result<ImageSettings, String> {
    let (revision, values) = store.snapshot()?;
    let base_url = normalize_base_url(values.get("images.seedream.baseUrl").and_then(|v| v.as_str()).unwrap_or(""))?;
    Ok(ImageSettings {
        revision,
        base_url,
        default_base_url: DEFAULT_BASE_URL.into(),
        configured: store.secret("images.seedream.apiKey")?.is_some(),
    })
}
fn effective_base_url(store: &SettingsStore) -> Result<String, String> {
    let value = settings(store)?.base_url;
    Ok(if value.is_empty() { DEFAULT_BASE_URL.into() } else { value })
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageInput {
    request_id: String,
    model: String,
    size: String,
    prompt: String,
    images: Vec<String>,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    mime_type: String,
    data: String,
}
#[derive(Serialize, specta::Type)]
pub struct ImageResult {
    images: Vec<ImageData>,
}
fn model_limits(model: &str) -> Result<(&'static [&'static str], usize, bool), String> {
    Ok(match model {
        "doubao-seedream-4-5-251128" => (&["2K", "4K"], 14, true),
        "doubao-seedream-5-0-lite-260128" => (&["2K", "3K", "4K"], 14, false),
        "doubao-seedream-5-0-pro-260628" => (&["1K", "2K"], 10, false),
        _ => return Err("Unsupported image model".into()),
    })
}
fn validate(input: &ImageInput) -> Result<bool, String> {
    let (sizes, limit, jpeg) = model_limits(&input.model)?;
    if !sizes.contains(&input.size.as_str())
        || input.prompt.trim().is_empty()
        || input.prompt.len() > 32000
        || input.images.len() > limit
    {
        return Err("Invalid image prompt, resolution or references".into());
    }
    Ok(jpeg)
}

async fn prepare_references(input: ImageReferencesInput) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || references::prepare(input))
        .await
        .map_err(|_| "Image reference preparation failed")?
}

#[tauri3_specta::command]
pub async fn images_prepare_references(
    window: tauri::Window, input: ImageReferencesInput,
) -> Result<Vec<String>, String> {
    check(&window)?;
    prepare_references(input).await
}

#[tauri3_specta::command]
pub async fn images_generate_seedream(
    window: tauri::Window, state: State<'_, SharedSettings>, mut input: ImageInput,
) -> Result<ImageResult, String> {
    check(&window)?;
    let jpeg = validate(&input)?;
    let (key, base_url) = {
        let store = state.0.lock().map_err(|_| "Settings lock poisoned")?;
        (
            store.secret("images.seedream.apiKey")?.ok_or("Configure a Seedream API key in image settings")?,
            effective_base_url(&store)?,
        )
    };
    if input.request_id.len() > 128 || input.request_id.is_empty() {
        return Err("Invalid image request identity".into());
    }
    let identity = (window.label().to_owned(), input.request_id.clone());
    let (sender, mut cancel) = tokio::sync::watch::channel(false);
    {
        let mut pending = requests().lock().map_err(|_| "Image request lock poisoned")?;
        if pending.contains_key(&identity) {
            return Err("Image request is already running".into());
        }
        pending.insert(identity.clone(), sender);
    }
    let outcome = tokio::select! {
        result = async {
            let envelope_bytes = serde_json::to_vec(&json!({
                "requestId": input.request_id, "model": input.model,
                "size": input.size, "prompt": input.prompt
            })).map_err(|_| "Cannot measure the image request")?.len();
            input.images = prepare_references(ImageReferencesInput {
                model: Some(input.model.clone()),
                images: std::mem::take(&mut input.images),
                envelope_bytes,
            }).await?;
            generate(&input, jpeg, &key, &base_url).await
        } => result,
        _ = cancel.changed() => Err("Image request cancelled; the provider may already have processed it".into()),
    };
    requests().lock().map_err(|_| "Image request lock poisoned")?.remove(&identity);
    {
        let store = state.0.lock().map_err(|_| "Settings lock poisoned")?;
        if store.secret("images.seedream.apiKey")?.as_deref() != Some(key.as_str())
            || effective_base_url(&store)? != base_url
        {
            return Err("Image provider connection changed during generation".into());
        }
    }
    outcome
}
async fn generate(input: &ImageInput, jpeg: bool, key: &str, base_url: &str) -> Result<ImageResult, String> {
    let mut body =
        json!({"model":input.model,"prompt":input.prompt,"size":input.size,"response_format":"url","watermark":false});
    if !input.images.is_empty() {
        body["image"] = json!(input.images);
    }
    if !jpeg {
        body["output_format"] = json!("png");
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "Image HTTP initialization failed")?;
    let mut response = client
        .post(format!("{base_url}/images/generations"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|_| "Image request failed; outcome is unknown, check before retrying")?;
    if !response.status().is_success() {
        let mut message = format!("Seedream {} failed (HTTP {})", input.model, response.status().as_u16());
        let request_id =
            response.headers().get("x-request-id").and_then(|value| value.to_str().ok()).map(str::to_owned);
        let mut bytes = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            if bytes.len() + chunk.len() > 16 * 1024 {
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            for field in ["code", "message"] {
                if let Some(detail) = body["error"][field].as_str() {
                    let detail: String = detail.replace(key, "[redacted]").chars().take(1024).collect();
                    message.push_str(&format!("; {detail}"));
                }
            }
        }
        if let Some(request_id) = request_id
            && !message.contains(&request_id)
        {
            let request_id: String = request_id.replace(key, "[redacted]").chars().take(128).collect();
            message.push_str(&format!("; Request ID: {request_id}"));
        }
        return Err(message);
    }
    let bytes = read_media(&mut response, MAX_MEDIA_BYTES).await?;
    let result: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid image response")?;
    let data = result["data"].as_array().filter(|v| !v.is_empty()).ok_or("Image service returned no images")?;
    // Image URLs can be signed CDN links; provider credentials are only sent to the generation endpoint.
    let download = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "Image HTTP initialization failed")?;
    let mut images = Vec::new();
    let mut total = 0;
    for item in data {
        let (bytes, encoded) = if let Some(encoded) = item["b64_json"].as_str().filter(|value| !value.is_empty()) {
            (STANDARD.decode(encoded).map_err(|_| "Invalid image encoding")?, encoded.to_owned())
        } else {
            let url = item["url"].as_str().ok_or("Image service returned no media")?;
            let mut response = download.get(url).send().await.map_err(|_| "Image download failed")?;
            if !response.status().is_success() {
                return Err(format!("Image download failed (HTTP {})", response.status().as_u16()));
            }
            let bytes = read_media(&mut response, (MAX_MEDIA_BYTES - total) / 4 * 3).await?;
            let encoded = STANDARD.encode(&bytes);
            (bytes, encoded)
        };
        total += encoded.len();
        if total > MAX_MEDIA_BYTES {
            return Err("Image result exceeds the ACP media limit".into());
        }
        let mime_type = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err("Image service returned an unsupported image format".into());
        };
        images.push(ImageData { mime_type: mime_type.into(), data: encoded });
    }
    Ok(ImageResult { images })
}
async fn read_media(response: &mut reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Image download failed")? {
        if bytes.len() + chunk.len() > limit {
            return Err("Image result exceeds the ACP media limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_urls_reject_embedded_credentials_and_nonlocal_plaintext() {
        assert_eq!(normalize_base_url("https://example.com/api/v3/").unwrap(), "https://example.com/api/v3");
        assert!(normalize_base_url("http://127.0.0.1:1234/v1").is_ok());
        for value in [
            "http://example.com/v1",
            "https://secret@example.com/v1",
            "https://example.com/v1?key=secret",
            "file:///tmp/image",
        ] {
            assert!(normalize_base_url(value).is_err());
        }
    }

    #[tokio::test]
    async fn seedream_downloads_media_without_forwarding_the_provider_credential() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let endpoint = base.clone();
        let png = STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=")
            .unwrap();
        let expected = STANDARD.encode(&png);
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 1024];
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
                requests.push(String::from_utf8_lossy(&bytes).into_owned());
                let body = if index == 0 {
                    serde_json::to_vec(&json!({"data":[{"url":format!("{endpoint}/media")}]})).unwrap()
                } else {
                    png.clone()
                };
                let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
            requests
        });
        let input = ImageInput {
            request_id: "test".into(),
            model: "doubao-seedream-5-0-pro-260628".into(),
            size: "1K".into(),
            prompt: "A tree".into(),
            images: vec![],
        };
        let result = generate(&input, false, "private-image-key", &base).await.unwrap();
        assert_eq!(result.images[0].data, expected);
        assert_eq!(result.images[0].mime_type, "image/png");
        let requests = worker.join().unwrap();
        assert!(requests[0].starts_with("POST /images/generations"));
        assert!(requests[0].to_ascii_lowercase().contains("authorization: bearer private-image-key"));
        assert!(requests[0].contains("\"size\":\"1K\""));
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
    }
    #[test]
    fn model_limits_and_references_are_checked() {
        let mut input = ImageInput {
            request_id: "test".into(),
            model: "doubao-seedream-5-0-pro-260628".into(),
            size: "2K".into(),
            prompt: "A tree".into(),
            images: vec![],
        };
        assert!(!validate(&input).unwrap());
        input.size = "4K".into();
        assert!(validate(&input).is_err());
        input.size = "2K".into();
        input.images = vec!["ignored".into(); 11];
        assert!(validate(&input).is_err());
    }
}
