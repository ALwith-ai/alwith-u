use std::{collections::BTreeMap, time::Duration};

use reqwest::{
    Client, Method, Url,
    header::{HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::{MAX_BYTES, require_installation};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpRequest {
    url: String,
    method: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    url: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn validate_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid legacy HTTP URL: {error}"))?;
    let allowed = matches!(
        url.host_str(),
        Some(
            "bi-api.finture.id"
                | "yup-knowledge-server.finture.id"
                | "martech-auth-qa02.finture.id"
                | "martech-auth-test.finture.id"
                | "martech-etms-test.finture.id"
                | "finture-intranet-api.finture.id"
        )
    );
    if !allowed
        || url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Legacy HTTP requires an approved HTTPS service without URL credentials, fragments or custom ports".into(),
        );
    }
    Ok(url)
}

fn build_request(client: &Client, request: HttpRequest) -> Result<reqwest::Request, String> {
    let url = validate_url(&request.url)?;
    let method = Method::from_bytes(request.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|error| format!("Invalid legacy HTTP method: {error}"))?;
    if !matches!(
        method,
        Method::GET | Method::HEAD | Method::POST | Method::PUT | Method::PATCH | Method::DELETE | Method::OPTIONS
    ) {
        return Err("Legacy HTTP method is not allowed".into());
    }
    let mut builder = client.request(method, url);
    for (name, value) in request.headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| format!("Invalid HTTP header: {error}"))?;
        if matches!(
            name.as_str(),
            "host"
                | "connection"
                | "transfer-encoding"
                | "content-length"
                | "proxy-authorization"
                | "proxy-connection"
                | "upgrade"
        ) {
            return Err(format!("Legacy HTTP cannot override transport header {name}"));
        }
        let value = HeaderValue::from_str(&value).map_err(|error| format!("Invalid HTTP header value: {error}"))?;
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        if body.len() > MAX_BYTES {
            return Err("Legacy HTTP request exceeds 64 MiB".into());
        }
        builder = builder.body(body);
    }
    builder.build().map_err(|error| format!("Build legacy HTTP request: {error}"))
}

#[tauri::command]
pub async fn legacy_http(
    window: tauri::Window, extension_id: String, request: HttpRequest,
) -> Result<HttpResponse, String> {
    require_installation(&window, &extension_id)?;
    // Never share the host's client/cookies or forward credentials across redirects.
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Create legacy HTTP client: {error}"))?;
    let request = build_request(&client, request)?;
    let mut response = client
        .execute(request)
        .await
        .map_err(|error| format!("Legacy HTTP request failed: {}", error.without_url()))?;
    if response.content_length().is_some_and(|length| length > MAX_BYTES as u64) {
        return Err("Legacy HTTP response exceeds 64 MiB".into());
    }
    let status = response.status().as_u16();
    let url = response.url().to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            value
                .to_str()
                .map(|value| (name.to_string(), value.to_owned()))
                .map_err(|error| format!("Invalid legacy response header: {error}"))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut body = Vec::new();
    while let Some(chunk) =
        response.chunk().await.map_err(|error| format!("Read legacy HTTP response: {}", error.without_url()))?
    {
        if chunk.len() > MAX_BYTES.saturating_sub(body.len()) {
            return Err("Legacy HTTP response exceeds 64 MiB".into());
        }
        body.extend_from_slice(&chunk);
    }
    // An uninstall during the request must not deliver a response to a stale extension.
    super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    Ok(HttpResponse { status, url, headers, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_binary_multipart_body_and_explicit_auth_headers() {
        let body =
            b"--boundary\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n\x00\x80\xff\r\n--boundary--\r\n"
                .to_vec();
        let request = build_request(
            &Client::new(),
            HttpRequest {
                url: "https://yup-knowledge-server.finture.id/upload".into(),
                method: Some("POST".into()),
                headers: BTreeMap::from([
                    ("Content-Type".into(), "multipart/form-data; boundary=boundary".into()),
                    ("Authorization".into(), "Bearer extension-secret".into()),
                ]),
                body: Some(body.clone()),
            },
        )
        .unwrap();
        assert_eq!(request.method(), Method::POST);
        assert_eq!(request.headers()["content-type"], "multipart/form-data; boundary=boundary");
        assert_eq!(request.headers()["authorization"], "Bearer extension-secret");
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), body);
    }

    #[test]
    fn rejects_transport_header_overrides_and_nonbusiness_methods() {
        for name in ["Host", "Content-Length", "Proxy-Authorization", "Transfer-Encoding"] {
            let result = build_request(
                &Client::new(),
                HttpRequest {
                    url: "https://bi-api.finture.id/api".into(),
                    method: None,
                    headers: BTreeMap::from([(name.into(), "invalid".into())]),
                    body: None,
                },
            );
            assert!(result.is_err(), "{name}");
        }
        let result = build_request(
            &Client::new(),
            HttpRequest {
                url: "https://bi-api.finture.id/api".into(),
                method: Some("CONNECT".into()),
                headers: BTreeMap::new(),
                body: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn allows_only_explicit_https_services_without_credentials_or_custom_ports() {
        for host in [
            "bi-api.finture.id",
            "yup-knowledge-server.finture.id",
            "martech-auth-qa02.finture.id",
            "martech-auth-test.finture.id",
            "martech-etms-test.finture.id",
            "finture-intranet-api.finture.id",
        ] {
            assert!(validate_url(&format!("https://{host}/api?q=1")).is_ok(), "{host}");
        }
        for url in [
            "http://bi-api.finture.id/api",
            "https://bi-api.finture.id.evil.test/api",
            "https://user:secret@bi-api.finture.id/api",
            "https://bi-api.finture.id:8443/api",
            "https://127.0.0.1/",
            "file:///etc/passwd",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
    }
}
