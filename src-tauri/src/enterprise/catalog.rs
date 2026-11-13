//! Validate API-issued enterprise metadata; the gateway and models are never bundled in U.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const PROVIDER_PREFIX: &str = "custom_alwith_enterprise_";

#[derive(Deserialize)]
pub(super) struct IssuedProvider {
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub hidden: bool,
    pub models: Vec<Model>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub(super) struct Model {
    #[serde(rename = "api_id")]
    pub api_id: String,
    pub label: String,
    pub context_window: Option<u64>,
    pub description: Option<String>,
}

pub(super) fn parse(value: Value) -> Result<Option<IssuedProvider>, String> {
    let rows = value.as_array().ok_or("Invalid ALwith provider response")?;
    let mut enterprise = rows.iter().filter(|row| row["auth_type"] == "enterprise_session");
    let Some(value) = enterprise.next() else { return Ok(None) };
    if enterprise.next().is_some() {
        return Err("Multiple enterprise gateways are not supported by the enterprise relay".into());
    }
    let provider: IssuedProvider =
        serde_json::from_value(value.clone()).map_err(|_| "Invalid enterprise provider metadata")?;
    if provider.hidden || provider.models.is_empty() {
        return Ok(None);
    }
    if provider.provider_id.trim().is_empty() || provider.name.trim().is_empty() {
        return Err("Missing enterprise provider identity".into());
    }
    let mut ids = BTreeSet::new();
    if provider.models.iter().any(|model| {
        model.api_id.trim().is_empty()
            || model.label.trim().is_empty()
            || model.context_window == Some(0)
            || !ids.insert(&model.api_id)
    }) {
        return Err("Invalid or duplicate enterprise model metadata".into());
    }
    Ok(Some(provider))
}

pub(super) fn apply_labels(
    provider: &mut IssuedProvider, labels: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    if labels.iter().any(|(id, label)| id.trim().is_empty() || label.trim().is_empty()) {
        return Err("Invalid enterprise model labels".into());
    }
    for model in &mut provider.models {
        if let Some(label) = labels.get(&model.api_id) {
            model.label.clone_from(label);
        }
    }
    Ok(())
}

pub(super) fn provider_id(account: &str, provider: &str) -> String {
    // Stable within an account; another account can never inherit a persisted model selection.
    format!("{PROVIDER_PREFIX}{}", hex::encode(Sha256::digest(format!("{}:{account}{provider}", account.len()))))
}
pub(super) fn runtime_id(provider: &str) -> String {
    format!("custom-{}", hex::encode(provider))
}
pub(super) fn model_id(provider: &str, model: &str) -> String {
    let encoded = model
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect::<String>();
    format!("gateway:{}:{encoded}", runtime_id(provider))
}
pub(super) fn is_model(model: &str) -> bool {
    model.starts_with(&format!("gateway:custom-{}", hex::encode(PROVIDER_PREFIX)))
        || model.starts_with("gateway:finture-enterprise:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn platform_labels_override_only_matching_gateway_model_names() {
        let mut provider = parse(json!([{"provider_id":"enterprise","auth_type":"enterprise_session","name":"Enterprise AI","base_url":"https://gateway.test","models":[{"api_id":"deepseek-V4.1-flash","label":"deepseek-V4.1-flash"},{"api_id":"unconfigured","label":"Gateway label"}]}])).unwrap().unwrap();
        let labels = std::collections::BTreeMap::from([
            ("deepseek-V4.1-flash".into(), "企业内部模型123".into()),
            ("platform-only".into(), "Not authorized by gateway".into()),
        ]);
        apply_labels(&mut provider, &labels).unwrap();
        assert_eq!(provider.models.len(), 2);
        assert_eq!(provider.models[0].api_id, "deepseek-V4.1-flash");
        assert_eq!(provider.models[0].label, "企业内部模型123");
        assert_eq!(provider.models[1].label, "Gateway label");
        assert_eq!(provider.base_url, "https://gateway.test");
    }

    #[test]
    fn catalog_accepts_issued_gateways_without_built_in_provider_ids() {
        let value = json!([{"provider_id":"company-issued","auth_type":"enterprise_session","name":"Issued","base_url":"https://issued.test","models":[{"api_id":"issued/model","label":"Issued"}]}]);
        let provider = parse(value).unwrap().unwrap();
        assert_eq!(provider.base_url, "https://issued.test");
        assert_eq!(provider.models[0].api_id, "issued/model");
        assert_ne!(provider_id("a", &provider.provider_id), provider_id("b", &provider.provider_id));
        assert!(is_model(&model_id(&provider_id("a", &provider.provider_id), "issued/model")));
        assert!(!is_model("gateway:custom-personal:model"));
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PublicProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<Model>,
}
pub(super) struct Connection {
    pub provider: PublicProvider,
    pub params: Value,
}

pub(super) async fn connection(
    app: &tauri::AppHandle, account: &str, provider: IssuedProvider, relay: alwith_enterprise_client::RelayConnection,
    host: &alwith_enterprise_client::EnterpriseClient, generation: u64,
) -> Result<Connection, String> {
    let id = provider_id(account, &provider.provider_id);
    let catalogs = alwith_chat::bundled_model_catalogs(app)?;
    let source = catalogs
        .iter()
        .find(|path| path.ends_with("alwith/models.json"))
        .ok_or("Shared ALwith model catalog unavailable")?;
    let models: Vec<_> = provider
        .models
        .iter()
        .map(|model| alwith_enterprise_client::CatalogModel {
            api_id: model.api_id.clone(),
            label: model.label.clone(),
            description: model.description.clone(),
            context_window: model.context_window,
        })
        .collect();
    let catalog = host.model_catalog(generation, source, &models).await.map_err(|reason| reason.to_string())?;
    Ok(connection_params(id, provider, relay, catalog.path, catalog.has_known_model))
}

fn connection_params(
    id: String, provider: IssuedProvider, relay: alwith_enterprise_client::RelayConnection, path: std::path::PathBuf,
    known: bool,
) -> Connection {
    let models: Vec<_> = provider.models.iter().map(|model| serde_json::json!({"id":model.api_id,"label":model.label,"description":model.description,"contextWindow":model.context_window})).collect();
    let mut config = if known {
        serde_json::json!({"model_reasoning_summary":"none"})
    } else {
        serde_json::json!({"features":{"code_mode":false,"code_mode_only":false}})
    };
    config["model_catalog_json"] = serde_json::json!(path);
    let params = serde_json::json!({"providerId":"openai","apiType":"openai","baseUrl":relay.base_url,"_meta":{
        "codex":{"id":runtime_id(&id),"name":provider.name,"mode":"catalog","bearerToken":relay.api_key,"config":config},
        "alwith":{"models":models}
    }});
    Connection {
        provider: PublicProvider { id, name: provider.name, base_url: provider.base_url, models: provider.models },
        params,
    }
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn enterprise_connections_preserve_codex_search_defaults() {
        for known in [false, true] {
            let provider = parse(json!([{"provider_id":"from-api","auth_type":"enterprise_session","name":"Issued","base_url":"https://issued.test","models":[{"api_id":"issued/model","label":"Issued"}]}])).unwrap().unwrap();
            let connection = connection_params(
                provider_id("account", &provider.provider_id),
                provider,
                alwith_enterprise_client::RelayConnection {
                    base_url: "http://127.0.0.1:8123/v1".into(),
                    api_key: "test-secret".into(),
                },
                "test-catalog.json".into(),
                known,
            );
            let config = &connection.params["_meta"]["codex"]["config"];
            assert!(config.get("web_search").is_none(), "known={known}");
            assert_eq!(config["model_catalog_json"], "test-catalog.json");
            if known {
                assert_eq!(config["model_reasoning_summary"], "none");
            } else {
                assert_eq!(config["features"], json!({"code_mode":false,"code_mode_only":false}));
            }
        }
    }

    #[test]
    fn relay_credentials_are_only_in_the_native_runtime_request() {
        let provider = parse(json!([{"provider_id":"from-api","auth_type":"enterprise_session","name":"Issued","base_url":"https://issued.test","models":[{"api_id":"issued/model","label":"Issued","context_window":120000}]}])).unwrap().unwrap();
        let id = provider_id("account", &provider.provider_id);
        let connection = connection_params(
            id.clone(),
            provider,
            alwith_enterprise_client::RelayConnection {
                base_url: "http://127.0.0.1:8123/v1".into(),
                api_key: "memory-only-secret".into(),
            },
            "test-catalog.json".into(),
            false,
        );
        let public = serde_json::to_value(&connection.provider).unwrap();
        assert_eq!(public["baseUrl"], "https://issued.test");
        assert_eq!(public["models"][0]["contextWindow"], 120000);
        assert!(!public.to_string().contains("memory-only-secret"));
        assert_eq!(connection.params["_meta"]["codex"]["bearerToken"], "memory-only-secret");
        assert_eq!(connection.params["_meta"]["codex"]["id"], runtime_id(&id));
        assert_eq!(connection.params["_meta"]["alwith"]["models"][0]["id"], "issued/model");
    }
}
