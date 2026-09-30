use alwith_extension::http::{self, HttpRequest, HttpResponse};
use reqwest::Url;
use tauri::Manager;

use super::require_installation;

fn validate_url(legacy_profile: Option<&str>, value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid extension HTTP URL: {error}"))?;
    let profiles = super::importer::profiles()?;
    let host = url.host_str().unwrap_or_default();
    let reserved = profiles.iter().any(|p| p.network_hosts.iter().any(|h| h == host));
    let business_allowed =
        profiles.iter().any(|p| Some(p.id.as_str()) == legacy_profile && p.network_hosts.iter().any(|h| h == host));
    let public_domain = host.parse::<std::net::IpAddr>().is_err()
        && !host.starts_with('[')
        && host.contains('.')
        && !host.ends_with('.')
        && !["localhost", "local", "internal", "test", "invalid", "example", "home", "lan", "onion"]
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    if (!business_allowed && (!public_domain || reserved))
        || url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Extension HTTP requires public HTTPS:443; business services require the matching compatibility profile"
                .into(),
        );
    }
    Ok(url)
}

#[tauri::command]
pub async fn legacy_http(
    window: tauri::Window, extension_id: String, request: HttpRequest,
) -> Result<HttpResponse, String> {
    require_installation(&window, &extension_id)?;
    let response = http::execute(request, |url| validate_url(Some(&extension_id), url)).await?;
    // An uninstall during the request must not deliver a response to a stale extension.
    super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    Ok(response)
}

#[tauri::command]
pub async fn extension_http(
    window: tauri::Window, extension_id: String, request: HttpRequest,
) -> Result<HttpResponse, String> {
    let installation = crate::extension_capabilities::require_installation(&window, &extension_id)?;
    // An ID alone never grants a business-domain exception. Compatibility packages
    // must pass the same native source/certificate checks as the legacy entry point.
    let legacy_profile = if installation.source == "legacy:alwith-u" {
        super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
        Some(extension_id.as_str())
    } else {
        None
    };
    let response = http::execute(request, |url| validate_url(legacy_profile, url)).await?;
    let current = crate::extension_capabilities::require_installation(&window, &extension_id)?;
    if current.installation_id != installation.installation_id
        || current.package_revision != installation.package_revision
        || current.data_generation != installation.data_generation
        || current.source != installation.source
    {
        return Err("Extension installation changed during HTTP request".into());
    }
    if legacy_profile.is_some() {
        super::importer::require_legacy_installation(window.app_handle(), &extension_id)?;
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_public_https_is_allowed_for_modern_and_legacy_extensions() {
        assert!(validate_url(None, "https://api.github.com/data").is_ok());
        assert!(validate_url(Some("weather-local"), "https://api.github.com/data").is_ok());
    }

    #[test]
    fn business_domains_require_an_authenticated_matching_legacy_profile() {
        let url = "https://bi-api.finture.id/api";
        assert!(validate_url(None, url).is_err());
        assert!(validate_url(Some("weather-local"), url).is_err());
        assert!(validate_url(Some("yup-kb"), url).is_ok());
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
            let id =
                if host.starts_with("bi-") || host.starts_with("yup-") { "yup-kb" } else { "etms-strategy-review" };
            assert!(validate_url(Some(id), &format!("https://{host}/api?q=1")).is_ok(), "{host}");
            assert!(validate_url(None, &format!("https://{host}/api")).is_err());
        }
        for url in [
            "http://bi-api.finture.id/api",
            "https://bi-api.finture.id.evil.test/api",
            "https://user:secret@bi-api.finture.id/api",
            "https://bi-api.finture.id:8443/api",
            "https://127.0.0.1/",
            "https://10.0.0.1/",
            "https://169.254.169.254/",
            "https://[::1]/",
            "https://localhost/",
            "https://a.internal/",
            "https://api.github.com/#fragment",
            "file:///etc/passwd",
        ] {
            assert!(validate_url(Some("yup-kb"), url).is_err(), "{url}");
        }
    }
}
