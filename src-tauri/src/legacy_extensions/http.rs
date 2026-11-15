use crate::extension_wire::{HttpRequest, HttpResponse};
use alwith_extension::http;
use reqwest::Url;
use tauri::Manager;

use super::require_installation;

pub(super) fn validate_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid extension HTTP URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Extension HTTP requires an HTTP or HTTPS URL".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Extension HTTP credentials must use request headers".into());
    }
    Ok(url)
}

#[tauri3_specta::command]
pub async fn legacy_http(
    window: tauri::Window, extension_id: String, request: HttpRequest,
) -> Result<HttpResponse, String> {
    require_installation(&window, &extension_id)?;
    let response = http::execute(request.into(), validate_url).await?;
    // An uninstall during the request must not deliver a response to a stale extension.
    super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    Ok(response.into())
}

#[tauri3_specta::command]
pub async fn extension_http(
    window: tauri::Window, extension_id: String, request: HttpRequest,
) -> Result<HttpResponse, String> {
    let installation = crate::extension_capabilities::require_installation(&window, &extension_id)?;
    let is_legacy = installation.source == "legacy:alwith-u";
    if is_legacy {
        super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    }
    let response = http::execute(request.into(), validate_url).await?;
    let current = crate::extension_capabilities::require_installation(&window, &extension_id)?;
    if current.installation_id != installation.installation_id
        || current.package_revision != installation.package_revision
        || current.data_generation != installation.data_generation
        || current.source != installation.source
    {
        return Err("Extension installation changed during HTTP request".into());
    }
    if is_legacy {
        super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    }
    Ok(response.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_services_do_not_require_a_matching_compatibility_profile() {
        for url in [
            "https://api.github.com/data",
            "https://bi-api.finture.id/api",
            "http://bi-api.finture.id:8502/api",
            "https://bi-api.finture.id:8443/api",
            "http://127.0.0.1:8080/",
            "http://10.0.0.1/",
            "http://[::1]:8080/",
            "http://localhost:8080/",
            "https://a.internal/api",
        ] {
            assert!(validate_url(url).is_ok(), "{url}");
        }
    }

    #[test]
    fn non_http_urls_and_embedded_credentials_are_rejected() {
        for url in ["file:///etc/passwd", "ftp://example.com/", "https://user:secret@example.com/", "invalid"] {
            assert!(validate_url(url).is_err(), "{url}");
        }
    }
}
