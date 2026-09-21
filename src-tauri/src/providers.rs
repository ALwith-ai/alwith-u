//! Application-owned provider credentials. Webviews receive only configured/region metadata.
//! A persisted revision becomes active only at an idle boundary under Runtime admission.
use alwith_api::{RunState, RuntimeClient};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};

const EVENT: &str = "providers:changed";
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Credential {
    api_key: String,
    region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModel {
    label: String,
    #[serde(rename = "api_id")]
    api_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CustomProvider {
    id: String,
    name: String,
    base_url: String,
    models: Vec<CustomModel>,
    api_key: String,
}
#[derive(Default, Debug, Deserialize, Serialize)]
struct Saved {
    revision: u64,
    #[serde(default)]
    credentials: BTreeMap<String, Credential>,
    #[serde(default)]
    custom_providers: BTreeMap<String, CustomProvider>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    applied_revision: Option<u64>,
    providers: BTreeMap<String, Metadata>,
    custom_providers: Vec<PublicCustomProvider>,
    status: &'static str,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Metadata {
    configured: bool,
    region: Option<String>,
    base_url: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCustomProvider {
    id: String,
    name: String,
    base_url: String,
    models: Vec<CustomModel>,
}
struct Inner {
    saved: Saved,
    applied: BTreeMap<String, AppliedProvider>,
    applied_revision: Option<u64>,
    error: Option<String>,
}
pub struct Providers {
    path: PathBuf,
    inner: tokio::sync::Mutex<Inner>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    api_key: Option<String>,
    region: Option<String>,
    base_url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomInput {
    id: Option<String>,
    name: String,
    api_key: Option<String>,
    base_url: String,
    models: Vec<CustomModel>,
}
#[derive(Clone, PartialEq)]
enum AppliedProvider {
    BuiltIn(Credential),
    Custom(CustomProvider),
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    ok: bool,
    code: &'static str,
    message: String,
    status: Option<u16>,
    latency_ms: Option<u128>,
}

impl Providers {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let path = app.path().app_data_dir()?.join("runtime-providers.json");
        let saved = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Saved::default(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            inner: tokio::sync::Mutex::new(Inner {
                saved,
                applied: BTreeMap::new(),
                applied_revision: None,
                error: None,
            }),
        })
    }
    pub async fn reset(&self) {
        let mut inner = self.inner.lock().await;
        inner.applied.clear();
        inner.applied_revision = None;
        inner.error = None;
    }
}
impl Inner {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.saved.revision,
            applied_revision: self.applied_revision,
            providers: self
                .saved
                .credentials
                .iter()
                .map(|(id, key)| {
                    (
                        id.clone(),
                        Metadata { configured: true, region: key.region.clone(), base_url: key.base_url.clone() },
                    )
                })
                .collect(),
            custom_providers: self
                .saved
                .custom_providers
                .values()
                .map(|provider| PublicCustomProvider {
                    id: provider.id.clone(),
                    name: provider.name.clone(),
                    base_url: provider.base_url.clone(),
                    models: provider.models.clone(),
                })
                .collect(),
            status: if self.error.is_some() {
                "failed"
            } else if self.applied_revision == Some(self.saved.revision) {
                "applied"
            } else {
                "pending"
            },
            error: self.error.clone(),
        }
    }
}
fn catalog() -> Vec<Value> {
    serde_json::from_str(include_str!("../../src/lib/provider-catalog.json")).expect("bundled provider catalog")
}
fn definition(id: &str) -> Result<Value, String> {
    catalog().into_iter().find(|v| v["id"] == id).ok_or("Unknown provider".into())
}
fn update(saved: &Saved, id: String, input: Option<Input>, expected_revision: u64) -> Result<Saved, String> {
    if saved.revision != expected_revision {
        return Err("Provider settings changed in another window; reload and retry".into());
    }
    let provider = definition(&id)?;
    let mut credentials = saved.credentials.clone();
    if let Some(input) = input {
        let region = if let Some(regions) = provider["regions"].as_array() {
            let selected = input.region.as_deref().unwrap_or_else(|| regions[0]["id"].as_str().expect("region id"));
            if !regions.iter().any(|r| r["id"] == selected) {
                return Err("Unknown provider region".into());
            }
            Some(selected.to_string())
        } else {
            None
        };
        let api_key = match input.api_key {
            Some(key) if !key.trim().is_empty() => key.trim().to_string(),
            Some(_) => return Err("API key cannot be empty".into()),
            None => credentials.get(&id).ok_or("Configure an API key first")?.api_key.clone(),
        };
        let base_url = match input.base_url {
            Some(value) if !value.trim().is_empty() => Some(normalize_base_url(&value)?),
            Some(_) => None,
            None => credentials.get(&id).and_then(|current| current.base_url.clone()),
        };
        credentials.insert(id, Credential { api_key, region, base_url });
    } else {
        credentials.remove(&id);
    }
    Ok(Saved {
        revision: saved.revision.checked_add(1).ok_or("Provider revision exhausted")?,
        credentials,
        custom_providers: saved.custom_providers.clone(),
    })
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(value.trim()).map_err(|_| "API base URL is invalid".to_string())?;
    let local_http = url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !local_http {
        return Err("API base URL must use HTTPS (HTTP is allowed only for localhost)".into());
    }
    if url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err("API base URL cannot contain credentials, query parameters, or a fragment".into());
    }
    let trimmed = url.path().trim_end_matches('/').to_string();
    url.set_path(if trimmed.is_empty() { "" } else { &trimmed });
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn update_custom(saved: &Saved, input: CustomInput, expected_revision: u64) -> Result<Saved, String> {
    if saved.revision != expected_revision {
        return Err("Provider settings changed in another window; reload and retry".into());
    }
    let id = input.id.unwrap_or_else(|| format!("custom_{}", uuid::Uuid::new_v4().simple()));
    if !id.starts_with("custom_") {
        return Err("Custom provider ID is invalid".into());
    }
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Provider name cannot be empty".into());
    }
    if input.models.is_empty() {
        return Err("Add at least one model".into());
    }
    let mut ids = BTreeSet::new();
    let models = input
        .models
        .into_iter()
        .map(|mut model| {
            model.label = model.label.trim().to_string();
            model.api_id = model.api_id.trim().to_string();
            if model.label.is_empty() || model.api_id.is_empty() {
                return Err("Model label and API ID cannot be empty".to_string());
            }
            if !ids.insert(model.api_id.clone()) {
                return Err("Model IDs must be unique".to_string());
            }
            if model.context_window == Some(0) {
                return Err("Model context window must be greater than zero".to_string());
            }
            Ok(model)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut custom_providers = saved.custom_providers.clone();
    let api_key = match input.api_key {
        Some(value) if !value.trim().is_empty() => value.trim().to_string(),
        Some(_) => return Err("API key cannot be empty".into()),
        None => custom_providers.get(&id).ok_or("Configure an API key first")?.api_key.clone(),
    };
    custom_providers.insert(
        id.clone(),
        CustomProvider { id, name: name.to_string(), base_url: normalize_base_url(&input.base_url)?, models, api_key },
    );
    Ok(Saved {
        revision: saved.revision.checked_add(1).ok_or("Provider revision exhausted")?,
        credentials: saved.credentials.clone(),
        custom_providers,
    })
}

fn remove_custom(saved: &Saved, id: &str, expected_revision: u64) -> Result<Saved, String> {
    if saved.revision != expected_revision {
        return Err("Provider settings changed in another window; reload and retry".into());
    }
    let mut custom_providers = saved.custom_providers.clone();
    if custom_providers.remove(id).is_none() {
        return Err("Unknown custom provider".into());
    }
    Ok(Saved {
        revision: saved.revision.checked_add(1).ok_or("Provider revision exhausted")?,
        credentials: saved.credentials.clone(),
        custom_providers,
    })
}

fn classify_response_failure(status: u16, body: &str, secret: &str) -> TestResult {
    let code = match status {
        401 | 403 => "unauthorized",
        404 => "not_found",
        429 => "rate_limited",
        400..=499 => "request_rejected",
        _ => "server_error",
    };
    let parsed = serde_json::from_str::<Value>(body).ok();
    let detail = parsed
        .as_ref()
        .and_then(|value| {
            value.pointer("/error/message").or_else(|| value.get("message")).or_else(|| value.get("detail"))
        })
        .and_then(Value::as_str)
        .unwrap_or("The provider rejected the connection test");
    let mut message = detail.replace(secret, "[redacted]");
    message.truncate(message.floor_char_boundary(300));
    TestResult { ok: false, code, message, status: Some(status), latency_ms: None }
}

fn classify_success_response(status: u16, body: &str, latency_ms: u128) -> TestResult {
    let valid = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("object").and_then(Value::as_str).map(str::to_string))
        .is_some_and(|object| object == "response");
    if !valid {
        return TestResult {
            ok: false,
            code: "invalid_response",
            message: "The endpoint returned success without a Responses API object".into(),
            status: Some(status),
            latency_ms: Some(latency_ms),
        };
    }
    TestResult {
        ok: true,
        code: "ok",
        message: "Connection succeeded".into(),
        status: Some(status),
        latency_ms: Some(latency_ms),
    }
}
fn persist(path: &std::path::Path, saved: &Saved) -> Result<(), String> {
    let directory = path.parent().ok_or("Provider path has no directory")?;
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    // NamedTempFile is private (0600 on Unix); replacement never exposes a partially written key.
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(saved).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn providers_read(state: State<'_, Providers>) -> Result<Snapshot, String> {
    Ok(state.inner.lock().await.snapshot())
}
#[tauri::command]
pub async fn providers_save(
    app: AppHandle, state: State<'_, Providers>, provider_id: String, input: Option<Input>, expected_revision: u64,
) -> Result<Snapshot, String> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    {
        let mut inner = state.inner.lock().await;
        let next = update(&inner.saved, provider_id, input, expected_revision)?;
        persist(&state.path, &next)?;
        inner.saved = next;
        inner.error = None;
    }
    if let Ok(client) = runtime.current() {
        let _ = apply_locked(&app, &client).await;
    }
    let snapshot = state.inner.lock().await.snapshot();
    let _ = app.emit(EVENT, &snapshot);
    Ok(snapshot)
}
#[tauri::command]
pub async fn providers_save_custom(
    app: AppHandle, state: State<'_, Providers>, input: CustomInput, expected_revision: u64,
) -> Result<Snapshot, String> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    {
        let mut inner = state.inner.lock().await;
        let next = update_custom(&inner.saved, input, expected_revision)?;
        persist(&state.path, &next)?;
        inner.saved = next;
        inner.error = None;
    }
    if let Ok(client) = runtime.current() {
        let _ = apply_locked(&app, &client).await;
    }
    let snapshot = state.inner.lock().await.snapshot();
    let _ = app.emit(EVENT, &snapshot);
    Ok(snapshot)
}
#[tauri::command]
pub async fn providers_remove_custom(
    app: AppHandle, state: State<'_, Providers>, provider_id: String, expected_revision: u64,
) -> Result<Snapshot, String> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    {
        let mut inner = state.inner.lock().await;
        let next = remove_custom(&inner.saved, &provider_id, expected_revision)?;
        persist(&state.path, &next)?;
        inner.saved = next;
        inner.error = None;
    }
    if let Ok(client) = runtime.current() {
        let _ = apply_locked(&app, &client).await;
    }
    let snapshot = state.inner.lock().await.snapshot();
    let _ = app.emit(EVENT, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn providers_test(state: State<'_, Providers>, provider_id: String) -> Result<TestResult, String> {
    let config = {
        let inner = state.inner.lock().await;
        test_config(&inner.saved, &provider_id)?
    };
    Ok(test_connection(config).await)
}
#[tauri::command]
pub async fn providers_apply(app: AppHandle) -> Result<Snapshot, String> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    let client = runtime.current()?;
    apply_locked(&app, &client).await?;
    Ok(app.state::<Providers>().inner.lock().await.snapshot())
}
pub fn schedule_apply(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let runtime = app.state::<crate::runtime::RuntimeState>();
        let Ok(_admission) = runtime.admission.try_lock() else {
            return;
        };
        if let Ok(client) = runtime.current() {
            let _ = apply_locked(&app, &client).await;
        }
    });
}
pub async fn apply_locked(app: &AppHandle, client: &Arc<RuntimeClient>) -> Result<(), String> {
    let state = app.state::<Providers>();
    let mut inner = state.inner.lock().await;
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let outcome = reconcile(&mut inner, client, &resource_dir).await;
    let _ = app.emit(EVENT, inner.snapshot());
    outcome
}

async fn reconcile(inner: &mut Inner, client: &RuntimeClient, resource_dir: &std::path::Path) -> Result<(), String> {
    if inner.applied_revision == Some(inner.saved.revision) {
        return Ok(());
    }
    if client
        .run_states()
        .await
        .map_err(crate::runtime::request_error)?
        .iter()
        .any(|s| matches!(s.state, RunState::Running | RunState::RequiresAction))
    {
        return Err("Provider settings are pending; finish or stop active turns before starting another turn".into());
    }
    let desired: BTreeMap<String, AppliedProvider> = inner
        .saved
        .credentials
        .iter()
        .map(|(id, key)| (id.clone(), AppliedProvider::BuiltIn(key.clone())))
        .chain(
            inner
                .saved
                .custom_providers
                .iter()
                .map(|(id, provider)| (id.clone(), AppliedProvider::Custom(provider.clone()))),
        )
        .collect();
    let outcome: Result<(), String> = async {
        for (id, selected) in &desired {
            if inner.applied.get(id) == Some(selected) { continue; }
            let (name, base_url, bearer_token, models, mut config, bundled_catalog) = match selected {
                AppliedProvider::BuiltIn(key) => {
                    let provider = definition(id)?;
                    let default_url = match key.region.as_deref() {
                        Some(region) => provider["regions"].as_array().and_then(|regions| regions.iter().find(|r| r["id"] == region)).map(|r| r["baseUrl"].clone()).ok_or("Unknown provider region")?,
                        None => provider["baseUrl"].clone(),
                    };
                    (provider["name"].clone(), key.base_url.clone().map(Value::String).unwrap_or(default_url), key.api_key.clone(), provider["models"].clone(), provider.get("config").cloned().unwrap_or(json!({})), provider["catalog"].as_str().map(str::to_string))
                }
                AppliedProvider::Custom(provider) => (
                    Value::String(provider.name.clone()),
                    Value::String(provider.base_url.clone()),
                    provider.api_key.clone(),
                    Value::Array(provider.models.iter().map(|model| json!({
                        "id": model.api_id,
                        "label": model.label,
                        "description": model.description,
                        "contextWindow": model.context_window,
                    })).collect()),
                    json!({}),
                    None,
                ),
            };
            if let Some(catalog) = bundled_catalog {
                config["model_catalog_json"] = json!(resource_dir.join(catalog));
            }
            client.acp_request("codex", "providers/set", json!({"providerId":"openai", "apiType":"openai", "baseUrl":base_url,
                "_meta":{"codex":{"id":id,"name":name,"mode":"catalog","bearerToken":bearer_token,"config":config}, "alwith":{"models":models}}}), None, None)
                .await.map_err(|e| format!("Provider {id} could not be applied ({}); retry at an idle boundary", e.code))?;
            inner.applied.insert(id.clone(), selected.clone());
        }
        let removed: Vec<_> = inner.applied.keys().filter(|id| !desired.contains_key(*id)).cloned().collect();
        for id in removed {
            client.acp_request("codex", "providers/disable", json!({"providerId":"openai","_meta":{"codex":{"id":id}}}), None, None)
                .await.map_err(|e| format!("Provider {id} could not be removed ({}); retry at an idle boundary", e.code))?;
            inner.applied.remove(&id);
        }
        Ok(())
    }.await;
    inner.error = outcome.as_ref().err().cloned();
    if outcome.is_ok() {
        inner.applied_revision = Some(inner.saved.revision);
    }
    outcome
}

#[derive(Clone)]
struct TestConfig {
    base_url: String,
    api_key: String,
    model: String,
}

fn test_config(saved: &Saved, id: &str) -> Result<TestConfig, String> {
    if let Some(provider) = saved.custom_providers.get(id) {
        return Ok(TestConfig {
            base_url: provider.base_url.clone(),
            api_key: provider.api_key.clone(),
            model: provider.models.first().ok_or("Add at least one model")?.api_id.clone(),
        });
    }
    let key = saved.credentials.get(id).ok_or("Configure and save this provider first")?;
    let provider = definition(id)?;
    let base_url = if let Some(url) = &key.base_url {
        url.clone()
    } else if let Some(region) = key.region.as_deref() {
        provider["regions"]
            .as_array()
            .and_then(|regions| regions.iter().find(|item| item["id"] == region))
            .and_then(|item| item["baseUrl"].as_str())
            .ok_or("Unknown provider region")?
            .to_string()
    } else {
        provider["baseUrl"].as_str().ok_or("Provider has no API base URL")?.to_string()
    };
    let model = provider["models"]
        .as_array()
        .and_then(|models| models.first())
        .and_then(|model| model["id"].as_str())
        .ok_or("Provider has no models")?
        .to_string();
    Ok(TestConfig { base_url, api_key: key.api_key.clone(), model })
}

async fn test_connection(config: TestConfig) -> TestResult {
    let started = Instant::now();
    let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(error) => {
            return TestResult {
                ok: false,
                code: "network",
                message: error.to_string(),
                status: None,
                latency_ms: None,
            };
        }
    };
    let request = match build_test_request(&client, &config) {
        Ok(request) => request,
        Err(error) => {
            return TestResult {
                ok: false,
                code: "request_failed",
                message: error.to_string(),
                status: None,
                latency_ms: None,
            };
        }
    };
    let response = client.execute(request).await;
    match response {
        Ok(response) if response.status().is_success() => {
            let status = response.status().as_u16();
            match response.text().await {
                Ok(body) => classify_success_response(status, &body, started.elapsed().as_millis()),
                Err(error) => TestResult {
                    ok: false,
                    code: "invalid_response",
                    message: error.to_string(),
                    status: Some(status),
                    latency_ms: Some(started.elapsed().as_millis()),
                },
            }
        }
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            classify_response_failure(status, &body, &config.api_key)
        }
        Err(error) => {
            let code = if error.is_timeout() {
                "timeout"
            } else if error.is_connect() {
                "network"
            } else {
                "request_failed"
            };
            let mut message = error.to_string().replace(&config.api_key, "[redacted]");
            message.truncate(message.floor_char_boundary(300));
            TestResult { ok: false, code, message, status: None, latency_ms: None }
        }
    }
}

fn build_test_request(client: &reqwest::Client, config: &TestConfig) -> Result<reqwest::Request, reqwest::Error> {
    client
        .post(format!("{}/responses", config.base_url.trim_end_matches('/')))
        .bearer_auth(&config.api_key)
        .json(&json!({"model": config.model, "input": "Reply with OK.", "max_output_tokens": 8, "store": false}))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn region_change_preserves_private_key_and_public_snapshot_never_contains_it() {
        let saved = update(
            &Saved::default(),
            "qwen".into(),
            Some(Input { api_key: Some("private-test-secret".into()), region: Some("intl".into()), base_url: None }),
            0,
        )
        .unwrap();
        let saved =
            update(&saved, "qwen".into(), Some(Input { api_key: None, region: Some("cn".into()), base_url: None }), 1)
                .unwrap();
        assert_eq!(saved.credentials["qwen"].api_key, "private-test-secret");
        assert_eq!(saved.credentials["qwen"].region.as_deref(), Some("cn"));
        let inner = Inner { saved, applied: BTreeMap::new(), applied_revision: None, error: None };
        let public = serde_json::to_string(&inner.snapshot()).unwrap();
        assert!(!public.contains("private-test-secret"));
        assert!(!public.contains("apiKey"));
        assert!(public.contains("pending"));
    }
    #[test]
    fn stale_edits_and_invalid_regions_do_not_replace_credentials() {
        let saved = Saved::default();
        assert!(update(&saved, "qwen".into(), None, 1).is_err());
        assert!(
            update(
                &saved,
                "qwen".into(),
                Some(Input { api_key: Some("test".into()), region: Some("invalid".into()), base_url: None }),
                0
            )
            .is_err()
        );
        assert!(saved.credentials.is_empty());
    }
    #[test]
    fn atomic_storage_roundtrips_and_is_private() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("providers.json");
        let saved = update(
            &Saved::default(),
            "deepseek".into(),
            Some(Input { api_key: Some("test".into()), region: None, base_url: None }),
            0,
        )
        .unwrap();
        persist(&path, &saved).unwrap();
        let loaded: Saved = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(loaded.revision, 1);
        assert_eq!(loaded.credentials["deepseek"].api_key, "test");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn legacy_provider_file_without_page_configuration_still_loads() {
        let saved: Saved = serde_json::from_str(
            r#"{"revision":4,"credentials":{"deepseek":{"apiKey":"private-test-secret","region":null}}}"#,
        )
        .unwrap();
        assert_eq!(saved.revision, 4);
        assert_eq!(saved.credentials["deepseek"].base_url, None);
        assert!(saved.custom_providers.is_empty());
    }

    #[test]
    fn built_in_base_url_override_is_normalized_and_keeps_the_private_key() {
        let saved = update(
            &Saved::default(),
            "deepseek".into(),
            Some(Input {
                api_key: Some("private-test-secret".into()),
                region: None,
                base_url: Some("https://gateway.example.test/v1/".into()),
            }),
            0,
        )
        .unwrap();
        assert_eq!(saved.credentials["deepseek"].base_url.as_deref(), Some("https://gateway.example.test/v1"));
        assert!(
            !serde_json::to_string(
                &Inner { saved, applied: BTreeMap::new(), applied_revision: None, error: None }.snapshot()
            )
            .unwrap()
            .contains("private-test-secret")
        );
    }

    #[test]
    fn custom_provider_requires_a_responses_url_and_unique_non_empty_models() {
        let input = CustomInput {
            id: Some("custom_existing".into()),
            name: "Private gateway".into(),
            api_key: Some("private-test-secret".into()),
            base_url: "https://gateway.example.test/v1/".into(),
            models: vec![CustomModel {
                label: "Model A".into(),
                api_id: "model-a".into(),
                context_window: Some(128_000),
                description: Some("Fast".into()),
            }],
        };
        let saved = update_custom(&Saved::default(), input, 0).unwrap();
        let provider = &saved.custom_providers["custom_existing"];
        assert_eq!(provider.base_url, "https://gateway.example.test/v1");
        assert_eq!(provider.models[0].api_id, "model-a");
        assert!(
            !serde_json::to_string(
                &Inner { saved, applied: BTreeMap::new(), applied_revision: None, error: None }.snapshot()
            )
            .unwrap()
            .contains("private-test-secret")
        );

        let duplicate = CustomInput {
            id: None,
            name: "Duplicate".into(),
            api_key: Some("key".into()),
            base_url: "https://gateway.example.test/v1".into(),
            models: vec![
                CustomModel { label: "A".into(), api_id: "same".into(), context_window: None, description: None },
                CustomModel { label: "B".into(), api_id: "same".into(), context_window: None, description: None },
            ],
        };
        assert_eq!(update_custom(&Saved::default(), duplicate, 0).unwrap_err(), "Model IDs must be unique");
    }

    #[test]
    fn custom_model_json_keeps_the_desktop_api_id_field() {
        let input: CustomInput = serde_json::from_value(json!({
            "id": "custom_private",
            "name": "Private gateway",
            "apiKey": "private-test-secret",
            "baseUrl": "https://gateway.example.test/v1",
            "models": [{"label":"Model A","api_id":"model-a","contextWindow":128000}]
        }))
        .unwrap();
        assert_eq!(input.models[0].api_id, "model-a");
        assert_eq!(serde_json::to_value(&input.models[0]).unwrap()["api_id"], "model-a");
    }

    #[test]
    fn removing_a_custom_provider_builds_a_new_revision_without_mutating_the_saved_snapshot() {
        let saved = update_custom(
            &Saved::default(),
            CustomInput {
                id: Some("custom_private".into()),
                name: "Private gateway".into(),
                api_key: Some("private-test-secret".into()),
                base_url: "https://gateway.example.test/v1".into(),
                models: vec![CustomModel {
                    label: "Model A".into(),
                    api_id: "model-a".into(),
                    context_window: None,
                    description: None,
                }],
            },
            0,
        )
        .unwrap();
        let next = remove_custom(&saved, "custom_private", 1).unwrap();
        assert_eq!(next.revision, 2);
        assert!(next.custom_providers.is_empty());
        assert!(saved.custom_providers.contains_key("custom_private"));
        assert!(remove_custom(&saved, "custom_private", 0).is_err());
    }

    #[test]
    fn response_errors_are_classified_and_secrets_are_redacted() {
        let body = r#"{"error":{"message":"Invalid key private-test-secret"}}"#;
        let failure = classify_response_failure(401, body, "private-test-secret");
        assert_eq!(failure.code, "unauthorized");
        assert_eq!(failure.status, Some(401));
        assert!(!failure.message.contains("private-test-secret"));
    }

    #[test]
    fn a_success_status_with_a_non_responses_body_is_not_reported_as_connected() {
        let result = classify_success_response(200, "<html>proxy login</html>", 12);
        assert!(!result.ok);
        assert_eq!(result.code, "invalid_response");
        assert_eq!(result.status, Some(200));
    }

    fn pending_provider() -> Inner {
        let saved = update(
            &Saved::default(),
            "qwen".into(),
            Some(Input { api_key: Some("private-test-secret".into()), region: Some("cn".into()), base_url: None }),
            0,
        )
        .unwrap();
        Inner { saved, applied: BTreeMap::new(), applied_revision: None, error: None }
    }
    fn fake_runtime(
        active: Arc<std::sync::atomic::AtomicBool>, fail: Arc<std::sync::atomic::AtomicBool>,
    ) -> (RuntimeClient, Arc<std::sync::Mutex<Vec<Value>>>) {
        use std::sync::atomic::Ordering;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let (host, peer) = tokio::io::duplex(16384);
        let (reader, writer) = tokio::io::split(host);
        let client = RuntimeClient::over(reader, writer);
        let calls = Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = Arc::clone(&calls);
        tokio::spawn(async move {
            let (reader, mut writer) = tokio::io::split(peer);
            let mut lines = tokio::io::BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let frame: Value = serde_json::from_str(&line).unwrap();
                let (result, error) = if frame["method"] == "runStates" {
                    (
                        if active.load(Ordering::SeqCst) {
                            json!([{"sessionId":"active","state":"running","reusableDraft":false,"owner":"u","cwd":"/tmp","title":"","since":0,"tasks":[],"listeningPorts":[],"executionId":null,"executionRole":null,"lastActivityAt":0}])
                        } else {
                            json!([])
                        },
                        Value::Null,
                    )
                } else {
                    recorded.lock().unwrap().push(frame.clone());
                    if fail.load(Ordering::SeqCst) {
                        (Value::Null, json!({"code":-32000,"message":"private-test-secret upstream failure"}))
                    } else {
                        (json!({}), Value::Null)
                    }
                };
                let response = json!({"id":frame["id"],"result":result,"error":error}).to_string() + "\n";
                if writer.write_all(response.as_bytes()).await.is_err() {
                    break;
                }
            }
        });
        (client, calls)
    }
    #[tokio::test]
    async fn active_turn_pins_old_revision_until_idle_then_applies_latest_once() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let active = Arc::new(AtomicBool::new(true));
        let (client, calls) = fake_runtime(active.clone(), Arc::new(AtomicBool::new(false)));
        let mut inner = pending_provider();
        assert!(reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.is_err());
        assert!(calls.lock().unwrap().is_empty());
        assert_eq!(inner.snapshot().status, "pending");
        inner.saved = update(
            &inner.saved,
            "qwen".into(),
            Some(Input { api_key: None, region: Some("intl".into()), base_url: None }),
            1,
        )
        .unwrap();
        active.store(false, Ordering::SeqCst);
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.applied_revision, Some(2));
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["params"]["params"]["baseUrl"], "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
        assert_eq!(calls[0]["params"]["params"]["_meta"]["codex"]["bearerToken"], "private-test-secret");
    }
    #[tokio::test]
    async fn failed_apply_is_not_acknowledged_and_can_retry_without_exposing_private_error() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let fail = Arc::new(AtomicBool::new(true));
        let (client, calls) = fake_runtime(Arc::new(AtomicBool::new(false)), fail.clone());
        let mut inner = pending_provider();
        assert!(reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.is_err());
        assert_eq!(inner.applied_revision, None);
        assert!(inner.applied.is_empty());
        assert_eq!(inner.snapshot().status, "failed");
        assert!(!serde_json::to_string(&inner.snapshot()).unwrap().contains("private-test-secret"));
        fail.store(false, Ordering::SeqCst);
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.snapshot().status, "applied");
        inner.saved = update(&inner.saved, "qwen".into(), None, 1).unwrap();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(calls.lock().unwrap().last().unwrap()["params"]["method"], "providers/disable");
        assert!(inner.applied.is_empty());
    }

    #[tokio::test]
    async fn custom_provider_models_are_mapped_from_page_schema_to_adapter_schema() {
        let saved = update_custom(
            &Saved::default(),
            CustomInput {
                id: Some("custom_private".into()),
                name: "Private gateway".into(),
                api_key: Some("private-test-secret".into()),
                base_url: "https://gateway.example.test/v1".into(),
                models: vec![CustomModel {
                    label: "Model A".into(),
                    api_id: "model-a".into(),
                    context_window: Some(128_000),
                    description: Some("Fast".into()),
                }],
            },
            0,
        )
        .unwrap();
        let (client, calls) = fake_runtime(
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut inner = Inner { saved, applied: BTreeMap::new(), applied_revision: None, error: None };
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        let calls = calls.lock().unwrap();
        let params = &calls[0]["params"]["params"];
        assert_eq!(params["baseUrl"], "https://gateway.example.test/v1");
        assert_eq!(params["_meta"]["codex"]["name"], "Private gateway");
        assert_eq!(
            params["_meta"]["alwith"]["models"],
            json!([{
                "id": "model-a",
                "label": "Model A",
                "description": "Fast",
                "contextWindow": 128000
            }])
        );
    }

    #[test]
    fn connection_test_builds_a_minimal_authenticated_responses_request() {
        let client = reqwest::Client::new();
        let request = build_test_request(
            &client,
            &TestConfig {
                base_url: "http://127.0.0.1:43210/v1".into(),
                api_key: "private-test-secret".into(),
                model: "model-a".into(),
            },
        )
        .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), "http://127.0.0.1:43210/v1/responses");
        assert_eq!(request.headers()[reqwest::header::AUTHORIZATION], "Bearer private-test-secret");
        let body = request.body().and_then(reqwest::Body::as_bytes).unwrap();
        let body: Value = serde_json::from_slice(body).unwrap();
        assert_eq!(body, json!({"model":"model-a","input":"Reply with OK.","max_output_tokens":8,"store":false}));
    }
}
