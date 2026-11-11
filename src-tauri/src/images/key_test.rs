//! Read-only credential probes; never call inference endpoints.
use super::*;

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageKeyTestResult {
    ok: bool,
    code: String,
    message: String,
    status: Option<u16>,
    latency_ms: Option<u64>,
}
impl ImageKeyTestResult {
    fn failure(code: &str, status: Option<u16>) -> Self {
        Self { ok: false, code: code.into(), message: String::new(), status, latency_ms: None }
    }
}

pub(super) async fn probe(provider: ImageProvider, key: &str, base_url: &str) -> ImageKeyTestResult {
    let started = std::time::Instant::now();
    let path = match provider {
        ImageProvider::Seedream => "models",
        ImageProvider::Minimax => "files/list?purpose=image_generation_input",
    };
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(_) => return ImageKeyTestResult::failure("network", None),
    };
    let mut response = match client.get(format!("{base_url}/{path}")).bearer_auth(key).send().await {
        Ok(response) => response,
        Err(error) => return ImageKeyTestResult::failure(if error.is_timeout() { "timeout" } else { "network" }, None),
    };
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return ImageKeyTestResult::failure(
            match status {
                401 => "unauthorized",
                403 => "forbidden",
                404 | 405 => "verification_unsupported",
                429 => "rate_limited",
                500..=599 => "server_error",
                _ => "request_rejected",
            },
            Some(status),
        );
    }
    // Bound metadata in memory and never expose or persist account file details.
    let bytes = match read_media(&mut response, 2 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return ImageKeyTestResult::failure("verification_invalid_response", Some(status)),
    };
    let body: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => return ImageKeyTestResult::failure("verification_invalid_response", Some(status)),
    };
    let valid = match provider {
        ImageProvider::Seedream => {
            body.get("data").is_some_and(serde_json::Value::is_array) && body.get("error").is_none()
        }
        ImageProvider::Minimax => match body.pointer("/base_resp/status_code").and_then(serde_json::Value::as_i64) {
            Some(0) => body.get("files").is_some_and(serde_json::Value::is_array),
            Some(1004 | 2049) => return ImageKeyTestResult::failure("unauthorized", Some(status)),
            Some(_) => return ImageKeyTestResult::failure("request_rejected", Some(status)),
            None => false,
        },
    };
    if !valid {
        return ImageKeyTestResult::failure("verification_invalid_response", Some(status));
    }
    ImageKeyTestResult {
        ok: true,
        code: "ok".into(),
        message: String::new(),
        status: Some(status),
        latency_ms: Some(started.elapsed().as_millis() as u64),
    }
}

#[cfg(test)]
#[path = "__tests__/key_test.rs"]
mod tests;
