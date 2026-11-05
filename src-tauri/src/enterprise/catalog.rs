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

pub(super) fn connection(
    app: &tauri::AppHandle, account: &str, provider: IssuedProvider, relay: alwith_enterprise_client::RelayConnection,
) -> Result<Connection, String> {
    use std::io::Write;
    let id = provider_id(account, &provider.provider_id);
    // Reuse the shared public catalog's instructions; U only projects API-issued enterprise metadata.
    let catalogs = alwith_chat::bundled_model_catalogs(app)?;
    let template_path = catalogs
        .iter()
        .find(|path| path.ends_with("qwen/models.json"))
        .ok_or("Shared model instructions unavailable")?;
    let known_path = catalogs
        .iter()
        .find(|path| path.ends_with("custom/models.json"))
        .ok_or("Shared custom model catalog unavailable")?;
    let known: Value = serde_json::from_slice(&std::fs::read(known_path).map_err(|reason| reason.to_string())?)
        .map_err(|reason| reason.to_string())?;
    let known_models = known["models"].as_array().ok_or("Invalid shared model catalog")?;
    let has_known_model =
        provider.models.iter().any(|model| known_models.iter().any(|entry| entry["slug"] == model.api_id));
    let template: Value = serde_json::from_slice(&std::fs::read(template_path).map_err(|reason| reason.to_string())?)
        .map_err(|reason| reason.to_string())?;
    let entries: Vec<_> = provider.models.iter().map(|model| {
        if let Some(entry) = known_models.iter().find(|entry| entry["slug"] == model.api_id) {
            let mut entry = entry.clone();
            entry["display_name"] = Value::String(model.label.clone());
            if let Some(context) = model.context_window { entry["context_window"] = context.into(); entry["max_context_window"] = context.into(); }
            return entry;
        }
        serde_json::json!({
        "slug":model.api_id,"display_name":model.label,"description":model.description,
        "base_instructions":template["models"][0]["base_instructions"],
        "supported_reasoning_levels":[],"shell_type":"shell_command","visibility":"list","supported_in_api":true,"priority":0,
        "support_verbosity":false,"supports_reasoning_summary_parameter":false,
        "truncation_policy":{"mode":"bytes","limit":10000},"experimental_supported_tools":[],"input_modalities":["text"],
        "context_window":model.context_window,"max_context_window":model.context_window,
        "apply_patch_tool_type":"freeform","tool_mode":"direct","include_apps_usage_instructions":false
    })}).collect();
    let bytes = serde_json::to_vec(&serde_json::json!({"models":entries})).map_err(|reason| reason.to_string())?;
    let path =
        std::env::temp_dir().join(format!("alwith-u-enterprise-catalog-{}.json", hex::encode(Sha256::digest(&bytes))));
    if !path.exists() {
        let mut file = tempfile::NamedTempFile::new_in(std::env::temp_dir()).map_err(|reason| reason.to_string())?;
        file.write_all(&bytes).map_err(|reason| reason.to_string())?;
        file.persist(&path).map_err(|reason| reason.to_string())?;
    }
    Ok(connection_params(id, provider, relay, path, has_known_model))
}

fn connection_params(
    id: String, provider: IssuedProvider, relay: alwith_enterprise_client::RelayConnection, path: std::path::PathBuf,
    known: bool,
) -> Connection {
    let models: Vec<_> = provider.models.iter().map(|model| serde_json::json!({"id":model.api_id,"label":model.label,"description":model.description,"contextWindow":model.context_window})).collect();
    let mut config = if known {
        serde_json::json!({"web_search":"disabled","model_reasoning_summary":"none"})
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
