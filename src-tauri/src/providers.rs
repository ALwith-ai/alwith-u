//! Application-owned provider credentials. Webviews receive only configured/region metadata.
//! Independent provider changes apply under Runtime admission; busy session routing stays pinned.
pub(crate) mod managed;

use alwith_api::{ResponseError, RuntimeClient};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::Instant,
};
use tauri::{AppHandle, Manager, State};
use tauri3_specta::Event;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Credential {
    api_key: String,
    region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, specta::Type)]
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
#[derive(Clone, Default, Debug, Deserialize, Serialize)]
struct Saved {
    revision: u64,
    #[serde(default)]
    credentials: BTreeMap<String, Credential>,
    #[serde(default)]
    custom_providers: BTreeMap<String, CustomProvider>,
    #[serde(default)]
    managed: Option<managed::Cache>,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[derive(tauri3_specta::Event)]
#[event(name = "providers:changed")]
pub struct Snapshot {
    revision: u64,
    applied_revision: Option<u64>,
    providers: BTreeMap<String, Metadata>,
    custom_providers: Vec<PublicCustomProvider>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    managed_providers: Vec<PublicCustomProvider>,
    status: &'static str,
    error: Option<String>,
}
#[derive(Clone, Serialize, specta::Type)]
pub struct Metadata {
    configured: bool,
    region: Option<String>,
    base_url: Option<String>,
}
#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PublicCustomProvider {
    id: String,
    name: String,
    base_url: String,
    models: Vec<CustomModel>,
}
struct Inner {
    managed_active: bool,
    saved: Saved,
    applied: BTreeMap<String, AppliedProvider>,
    applied_revision: Option<u64>,
    error: Option<String>,
}
pub struct Providers {
    managed: managed::State,
    auxiliary: tokio::sync::Mutex<BTreeMap<String, Inner>>,
    path: PathBuf,
    inner: tokio::sync::Mutex<Inner>,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
}
#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomInput {
    #[serde(default)]
    id: Option<String>,
    name: String,
    #[serde(default)]
    api_key: Option<String>,
    base_url: String,
    models: Vec<CustomModel>,
}
#[derive(Clone, PartialEq)]
enum AppliedProvider {
    BuiltIn(Credential),
    Custom(CustomProvider),
}
#[derive(Serialize, specta::Type)]
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
            managed: managed::State::default(),
            auxiliary: tokio::sync::Mutex::new(BTreeMap::new()),
            path,
            inner: tokio::sync::Mutex::new(Inner {
                managed_active: false,
                saved,
                applied: BTreeMap::new(),
                applied_revision: None,
                error: None,
            }),
        })
    }
    pub async fn reset(&self) {
        self.managed.gate.lock().unwrap().targets.remove("codex");
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
            managed_providers: self
                .saved
                .managed
                .as_ref()
                .filter(|_| self.managed_active)
                .and_then(|cache| cache.provider.as_ref())
                .map(|provider| {
                    vec![PublicCustomProvider {
                        id: provider.id.clone(),
                        name: provider.name.clone(),
                        base_url: provider.base_url.clone(),
                        models: provider.models.clone(),
                    }]
                })
                .unwrap_or_default(),
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
/// Provider metadata loaded by U's bootstrap before Codex starts. Gateway entries remain hidden in
/// the native catalog; the adapter advertises only the models registered by configured providers.
pub fn bundled_model_catalogs(resources: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    catalog()
        .iter()
        .filter_map(|provider| provider["catalog"].as_str())
        .chain(std::iter::once("custom/models.json"))
        .map(|relative| {
            let path = resources.join(relative);
            if path.is_file() { Ok(path) } else { Err(format!("Model catalog missing at {}", path.display())) }
        })
        .collect()
}

fn catalog() -> Vec<Value> {
    serde_json::from_str(include_str!("../../src/lib/provider-catalog.json")).expect("bundled provider catalog")
}
fn managed_definition() -> Value {
    catalog()
        .into_iter()
        .find(|provider| provider["id"] == managed::ID && provider["source"] == "account")
        .expect("bundled ALwith account configuration")
}

fn apply_managed_model_overrides(models: &mut Value) {
    let definition = managed_definition();
    let catalog: Value =
        serde_json::from_str(include_str!("../resources/alwith/models.json")).expect("bundled ALwith model catalog");
    for model in models.as_array_mut().expect("provider models") {
        if let Some(configured) =
            definition["models"].as_array().expect("configured models").iter().find(|entry| entry["id"] == model["id"])
        {
            model["label"] = configured["label"].clone();
        }
        if let Some(entry) =
            catalog["models"].as_array().expect("catalog models").iter().find(|entry| entry["slug"] == model["id"])
        {
            model["contextWindow"] = entry["context_window"].clone();
        }
    }
}

fn has_custom_model_metadata(provider: &CustomProvider) -> bool {
    let catalog: Value =
        serde_json::from_str(include_str!("../resources/custom/models.json")).expect("bundled custom model catalog");
    provider.models.iter().any(|model| {
        catalog["models"].as_array().expect("catalog models").iter().any(|entry| entry["slug"] == model.api_id)
    })
}

fn definition(id: &str) -> Result<Value, String> {
    catalog().into_iter().find(|v| v["id"] == id && v["source"] != "account").ok_or("Unknown provider".into())
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
        managed: saved.managed.clone(),
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
        managed: saved.managed.clone(),
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
        managed: saved.managed.clone(),
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
    let parsed = serde_json::from_str::<Value>(body).ok();
    let valid = parsed.as_ref().is_some_and(|value| {
        value["object"] == "response"
            && matches!(value["status"].as_str(), Some("completed" | "incomplete"))
            && value.get("error").is_none_or(Value::is_null)
    });
    if !valid {
        return TestResult {
            ok: false,
            code: "invalid_response",
            message: "The endpoint did not return a successful Responses API result".into(),
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
#[tauri3_specta::command]
pub async fn providers_read(state: State<'_, Providers>) -> Result<Snapshot, String> {
    Ok(state.inner.lock().await.snapshot())
}
#[tauri3_specta::command]
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
    let _ = snapshot.emit(&app);
    Ok(snapshot)
}
#[tauri3_specta::command]
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
    let _ = snapshot.emit(&app);
    Ok(snapshot)
}
#[tauri3_specta::command]
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
    let _ = snapshot.emit(&app);
    Ok(snapshot)
}

#[tauri3_specta::command]
pub async fn providers_test(state: State<'_, Providers>, provider_id: String) -> Result<TestResult, String> {
    let config = {
        let inner = state.inner.lock().await;
        test_config(&inner.saved, &provider_id)?
    };
    Ok(test_connection(config).await)
}
#[tauri3_specta::command]
pub async fn providers_apply(app: AppHandle) -> Result<Snapshot, String> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    // Draft preparation can use the applied catalog while another admission is pending.
    // The admission owner schedules reconciliation when it releases the lock.
    let _admission = try_apply_admission(&runtime.admission)?;
    let client = runtime.current()?;
    apply_locked(&app, &client).await?;
    Ok(app.state::<Providers>().inner.lock().await.snapshot())
}
fn try_apply_admission(admission: &tokio::sync::Mutex<()>) -> Result<tokio::sync::MutexGuard<'_, ()>, String> {
    admission.try_lock().map_err(|_| PROVIDERS_PENDING.to_owned())
}

/// Configure only a newly created Gamepad agent; credentials never leave the native host.
#[tauri3_specta::command]
pub async fn gamepad_ai_prepare(window: tauri::WebviewWindow, agent_id: String) -> Result<(), String> {
    if !matches!(window.label(), "main" | "settings" | "gamepad") {
        return Err("Gamepad AI is unavailable in this window".into());
    }
    let suffix = agent_id.strip_prefix("gamepad-config-").ok_or("Invalid Gamepad AI agent")?;
    if suffix.len() != 36 || !suffix.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid Gamepad AI agent".into());
    }
    let app = window.app_handle();
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    let client = runtime.current()?;
    if !client.agents().await.map_err(crate::runtime::request_error)?.iter().any(|agent| agent["agentId"] == agent_id) {
        return Err("Gamepad AI agent is not running".into());
    }
    let providers = app.state::<Providers>();
    let inner = providers.inner.lock().await;
    let saved = inner.saved.clone();
    let managed_active = inner.managed_active && providers.managed.gate.lock().unwrap().account.is_some();
    if managed_active {
        providers.managed.gate.lock().unwrap().targets.insert(agent_id.clone());
    }
    drop(inner);
    let mut auxiliary = providers.auxiliary.lock().await;
    let ephemeral = auxiliary.entry(agent_id.clone()).or_insert_with(|| Inner {
        managed_active,
        saved: saved.clone(),
        applied: BTreeMap::new(),
        applied_revision: None,
        error: None,
    });
    ephemeral.saved = saved;
    if ephemeral.managed_active != managed_active {
        ephemeral.applied_revision = None;
    }
    ephemeral.managed_active = managed_active;
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    reconcile_target(ephemeral, &client, &resource_dir, &agent_id).await
}

pub fn schedule_apply(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let providers = app.state::<Providers>();
        if let Ok(_transition) = providers.managed.transition.try_lock()
            && let Err(error) = managed::cleanup(&app).await
        {
            let mut inner = providers.inner.lock().await;
            inner.error = Some(error);
            let _ = inner.snapshot().emit(&app);
            return;
        }
        let runtime = app.state::<crate::runtime::RuntimeState>();
        // The last idle notification may arrive while another admission still owns
        // the lock. Queue the retry so a saved revision cannot remain pending forever.
        let _admission = runtime.admission.lock().await;
        if let Ok(client) = runtime.current() {
            let _ = apply_locked(&app, &client).await;
        }
    });
}
pub async fn apply_locked(app: &AppHandle, client: &Arc<RuntimeClient>) -> Result<(), String> {
    let state = app.state::<Providers>();
    let mut inner = state.inner.lock().await;
    if state.managed.gate.lock().unwrap().account.is_none() && inner.managed_active {
        inner.managed_active = false;
        inner.applied_revision = None;
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    if inner.managed_active && inner.saved.managed.as_ref().is_some_and(|cache| cache.provider.is_some()) {
        state.managed.gate.lock().unwrap().targets.insert("codex".into());
    }
    let outcome = reconcile(&mut inner, client, &resource_dir).await;
    let _ = inner.snapshot().emit(app);
    let saved = inner.saved.clone();
    let active = inner.managed_active;
    drop(inner);
    let mut auxiliary = state.auxiliary.lock().await;
    if !auxiliary.is_empty() {
        let live = client.agents().await.map_err(crate::runtime::request_error)?;
        auxiliary.retain(|id, _| live.iter().any(|agent| agent["agentId"] == *id));
        for (id, target) in auxiliary.iter_mut() {
            target.saved = saved.clone();
            if target.managed_active != active {
                target.applied_revision = None;
            }
            target.managed_active = active;
            if active {
                state.managed.gate.lock().unwrap().targets.insert(id.clone());
            }
            reconcile_target(target, client, &resource_dir, id).await?;
        }
    }
    outcome
}

async fn reconcile(inner: &mut Inner, client: &RuntimeClient, resource_dir: &std::path::Path) -> Result<(), String> {
    reconcile_target(inner, client, resource_dir, "codex").await
}

async fn reconcile_target(
    inner: &mut Inner, client: &RuntimeClient, resource_dir: &std::path::Path, agent_id: &str,
) -> Result<(), String> {
    if inner.applied_revision == Some(inner.saved.revision) {
        return Ok(());
    }
    // The adapter owns session routing and rejects only changes affecting busy sessions.
    // A global Runtime idle check would also block unrelated provider additions.
    let mut pending = false;
    let mut failures = Vec::new();
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
        .chain(
            inner
                .saved
                .managed
                .as_ref()
                .filter(|_| inner.managed_active)
                .and_then(|cache| cache.provider.as_ref())
                .map(|provider| (managed::ID.to_string(), AppliedProvider::Custom(provider.clone()))),
        )
        .collect();
    // A revision without catalog changes does not need an idle boundary.
    if inner.applied == desired {
        inner.applied_revision = Some(inner.saved.revision);
        inner.error = None;
        return Ok(());
    }
    let outcome: Result<(), String> = async {
        for (id, selected) in &desired {
            if inner.applied.get(id) == Some(selected) { continue; }
            let runtime_id = runtime_provider_id(id);
            let (name, base_url, bearer_token, mut models, mut config, bundled_catalog) = match selected {
                AppliedProvider::BuiltIn(key) => {
                    let provider = definition(id)?;
                    let default_url = match key.region.as_deref() {
                        Some(region) => provider["regions"].as_array().and_then(|regions| regions.iter().find(|r| r["id"] == region)).map(|r| r["baseUrl"].clone()).ok_or("Unknown provider region")?,
                        None => provider["baseUrl"].clone(),
                    };
                    (provider["name"].clone(), key.base_url.clone().map(Value::String).unwrap_or(default_url), key.api_key.clone(), provider["models"].clone(), provider.get("config").cloned().unwrap_or(json!({})), provider["catalog"].as_str().map(str::to_string))
                }
                AppliedProvider::Custom(provider) => {
                    let known = has_custom_model_metadata(provider);
                    (
                    Value::String(provider.name.clone()),
                    Value::String(provider.base_url.clone()),
                    provider.api_key.clone(),
                    Value::Array(provider.models.iter().map(|model| json!({
                        "id": model.api_id,
                        "label": model.label,
                        "description": model.description,
                        "contextWindow": model.context_window,
                    })).collect()),
                    if known { json!({"web_search": "disabled", "model_reasoning_summary": "none"}) } else { json!({}) },
                    known.then(|| "custom/models.json".to_string()),
                )},
            };
            let bundled_catalog = if id == managed::ID {
                let definition = managed_definition();
                apply_managed_model_overrides(&mut models);
                config = definition["config"].clone();
                definition["catalog"].as_str().map(str::to_string)
            } else {
                bundled_catalog
            };
            if let Some(catalog) = bundled_catalog {
                config["model_catalog_json"] = json!(resource_dir.join(catalog));
            }
            let result = client.acp_request(agent_id, "providers/set", json!({"providerId":"openai", "apiType":"openai", "baseUrl":base_url,
                "_meta":{"codex":{"id":runtime_id,"name":name,"mode":"catalog","bearerToken":bearer_token,"config":config}, "alwith":{"models":models}}}), None, None)
                ;
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), result).await
                .unwrap_or_else(|_| Err(ResponseError::runtime("Provider configuration timed out")));
            if let Err(error) = result {
                record_application_error(id, "apply", &error, &mut pending, &mut failures);
                continue;
            }
            inner.applied.insert(id.clone(), selected.clone());
        }
        let removed: Vec<_> = inner.applied.keys().filter(|id| !desired.contains_key(*id)).cloned().collect();
        for id in removed {
            let result = client.acp_request(agent_id, "providers/disable", json!({"providerId":"openai","_meta":{"codex":{"id":runtime_provider_id(&id)}}}), None, None)
                ;
            let result = tokio::time::timeout(std::time::Duration::from_secs(10), result).await
                .unwrap_or_else(|_| Err(ResponseError::runtime("Provider configuration timed out")));
            if let Err(error) = result {
                record_application_error(&id, "remove", &error, &mut pending, &mut failures);
                continue;
            }
            inner.applied.remove(&id);
        }
        Ok(())
    }.await;
    inner.error = outcome.err().or_else(|| (!failures.is_empty()).then(|| failures.join("; ")));
    if inner.error.is_none() && !pending {
        inner.applied_revision = Some(inner.saved.revision);
    }
    log::info!(
        "Provider catalog: agent={agent_id} saved_revision={} applied_revision={:?} status={} pending_affected_sessions={pending}",
        inner.saved.revision,
        inner.applied_revision,
        inner.snapshot().status
    );
    if let Some(error) = &inner.error {
        Err(error.clone())
    } else if pending {
        Err(PROVIDERS_PENDING.into())
    } else {
        Ok(())
    }
}

const PROVIDERS_PENDING: &str = "Provider settings are pending; waiting for affected sessions to finish";

pub(crate) fn application_pending(error: &str) -> bool {
    error == PROVIDERS_PENDING
}

fn record_application_error(
    id: &str, operation: &str, error: &ResponseError, pending: &mut bool, failures: &mut Vec<String>,
) {
    // Match the installed adapter's busy response exactly; other invalid requests are failures.
    let busy = error.code == -32600
        && error.message == "Invalid request: Wait for affected sessions to finish before changing their provider";
    log::warn!("Provider catalog: provider={id} operation={operation} code={} waiting_for_sessions={busy}", error.code);
    if busy {
        *pending = true;
    } else {
        failures.push(format!("Provider {id} could not {operation} ({}); retry to apply saved settings", error.code));
    }
}

/// Preserve saved IDs while encoding custom IDs without collisions for the adapter's [a-z0-9-]+ grammar.
/// Keep this mapping aligned with gatewayModelId in src/lib/providers.ts.
fn runtime_provider_id(id: &str) -> String {
    if id.starts_with("custom_") {
        format!("custom-{}", id.bytes().map(|byte| format!("{byte:02x}")).collect::<String>())
    } else {
        id.to_string()
    }
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
        .json(&json!({"model": config.model, "input": "Reply with OK.", "max_output_tokens": 16, "store": false}))
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
        let inner =
            Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None };
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
                &Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None }
                    .snapshot()
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
                &Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None }
                    .snapshot()
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

    #[test]
    fn failed_or_pending_responses_are_not_reported_as_connected() {
        for body in [
            r#"{"object":"response","status":"failed","error":{"message":"Invalid API key"}}"#,
            r#"{"object":"response","status":"completed","error":{"message":"Upstream failed"}}"#,
            r#"{"object":"response","status":"in_progress"}"#,
            r#"{"object":"response"}"#,
        ] {
            assert!(!classify_success_response(200, body, 12).ok);
        }
        for status in ["completed", "incomplete"] {
            let body = json!({"object":"response","status":status,"error":null}).to_string();
            assert!(classify_success_response(200, &body, 12).ok);
        }
    }

    #[tokio::test]
    async fn unchanged_catalog_acknowledges_revision_while_another_turn_runs() {
        use std::sync::atomic::AtomicBool;
        let (client, calls) = fake_runtime(Arc::new(AtomicBool::new(true)), Arc::new(AtomicBool::new(false)));
        let mut inner = Inner {
            managed_active: false,
            saved: Saved::default(),
            applied: BTreeMap::new(),
            applied_revision: None,
            error: None,
        };
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.snapshot().status, "applied");
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn draft_catalog_read_does_not_wait_for_another_sessions_admission() {
        let admission = tokio::sync::Mutex::new(());
        let sending = admission.lock().await;
        let error = try_apply_admission(&admission).unwrap_err();
        assert!(application_pending(&error));
        drop(sending);
        assert!(try_apply_admission(&admission).is_ok());
    }

    fn pending_provider() -> Inner {
        let saved = update(
            &Saved::default(),
            "qwen".into(),
            Some(Input { api_key: Some("private-test-secret".into()), region: Some("cn".into()), base_url: None }),
            0,
        )
        .unwrap();
        Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None }
    }
    fn fake_runtime(
        active: Arc<std::sync::atomic::AtomicBool>, fail: Arc<std::sync::atomic::AtomicBool>,
    ) -> (RuntimeClient, Arc<std::sync::Mutex<Vec<Value>>>) {
        fake_runtime_with_busy(active, fail, Arc::new(std::sync::atomic::AtomicBool::new(false)))
    }
    fn fake_runtime_with_busy(
        active: Arc<std::sync::atomic::AtomicBool>, fail: Arc<std::sync::atomic::AtomicBool>,
        busy: Arc<std::sync::atomic::AtomicBool>,
    ) -> (RuntimeClient, Arc<std::sync::Mutex<Vec<Value>>>) {
        fake_runtime_state(active, fail, busy, None)
    }
    fn fake_runtime_with_interruption(
        active: Arc<std::sync::atomic::AtomicBool>, fail: Arc<std::sync::atomic::AtomicBool>,
        interruption: Option<&'static str>,
    ) -> (RuntimeClient, Arc<std::sync::Mutex<Vec<Value>>>) {
        fake_runtime_state(active, fail, Arc::new(std::sync::atomic::AtomicBool::new(false)), interruption)
    }
    fn fake_runtime_state(
        active: Arc<std::sync::atomic::AtomicBool>, fail: Arc<std::sync::atomic::AtomicBool>,
        busy: Arc<std::sync::atomic::AtomicBool>, interruption: Option<&'static str>,
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
                            json!([{"sessionId":"active","state":if interruption.is_some() { "requires_action" } else { "running" },"version":1,"interruption":interruption,"reusableDraft":false,"owner":"u","cwd":"/tmp","title":"","since":0,"tasks":[],"listeningPorts":[],"executionId":null,"executionRole":null,"lastActivityAt":0}])
                        } else {
                            json!([])
                        },
                        Value::Null,
                    )
                } else {
                    recorded.lock().unwrap().push(frame.clone());
                    if busy.load(Ordering::SeqCst) && frame["params"]["params"]["_meta"]["codex"]["id"] == "qwen" {
                        (
                            Value::Null,
                            json!({"code":-32600,"message":"Invalid request: Wait for affected sessions to finish before changing their provider"}),
                        )
                    } else if fail.load(Ordering::SeqCst) {
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
    async fn restored_interrupted_session_allows_saved_provider_application() {
        use std::sync::atomic::AtomicBool;
        let (client, calls) = fake_runtime_with_interruption(
            Arc::new(AtomicBool::new(true)),
            Arc::new(AtomicBool::new(false)),
            Some("runtime_stopped"),
        );
        let mut inner = pending_provider();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.snapshot().status, "applied");
        assert_eq!(calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn gamepad_catalog_targets_only_ephemeral_agent_while_main_turn_runs() {
        use std::sync::atomic::AtomicBool;
        let (client, calls) = fake_runtime(Arc::new(AtomicBool::new(true)), Arc::new(AtomicBool::new(false)));
        let main = pending_provider();
        let before = serde_json::to_value(main.snapshot()).unwrap();
        let mut ephemeral = Inner {
            managed_active: false,
            saved: main.saved.clone(),
            applied: BTreeMap::new(),
            applied_revision: None,
            error: None,
        };
        reconcile_target(&mut ephemeral, &client, std::path::Path::new("/resources"), "gamepad-config-test")
            .await
            .unwrap();
        assert_eq!(serde_json::to_value(main.snapshot()).unwrap(), before);
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["params"]["agentId"], "gamepad-config-test");
        assert_eq!(calls[0]["params"]["method"], "providers/set");
        assert_eq!(ephemeral.applied_revision, Some(main.saved.revision));
        assert_eq!(main.applied_revision, None);
    }

    #[tokio::test]
    async fn unrelated_active_turn_does_not_block_new_provider() {
        use std::sync::atomic::AtomicBool;
        let (client, calls) = fake_runtime(Arc::new(AtomicBool::new(true)), Arc::new(AtomicBool::new(false)));
        let mut inner = pending_provider();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.snapshot().status, "applied");
        assert_eq!(inner.applied_revision, Some(1));
        assert_eq!(calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn busy_provider_does_not_block_independent_changes_and_retries_only_pending() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let busy = Arc::new(AtomicBool::new(true));
        let (client, calls) =
            fake_runtime_with_busy(Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)), busy.clone());
        let mut inner = pending_provider();
        let mut key = inner.saved.credentials["qwen"].clone();
        key.region = None;
        inner.saved.credentials.insert("xai".into(), key);
        assert!(reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.is_err());
        assert_eq!(inner.snapshot().status, "pending");
        assert!(inner.error.is_none());
        assert!(inner.applied.contains_key("xai"));
        assert!(!inner.applied.contains_key("qwen"));
        busy.store(false, Ordering::SeqCst);
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert_eq!(inner.snapshot().status, "applied");
        let calls = calls.lock().unwrap();
        let ids: Vec<_> =
            calls.iter().map(|call| call["params"]["params"]["_meta"]["codex"]["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["qwen", "xai", "qwen"]);
    }
    #[tokio::test]
    async fn busy_removal_keeps_routing_while_other_removals_apply() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let busy = Arc::new(AtomicBool::new(true));
        let (client, calls) =
            fake_runtime_with_busy(Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)), busy.clone());
        let mut inner = pending_provider();
        let old = AppliedProvider::BuiltIn(inner.saved.credentials["qwen"].clone());
        inner.applied.insert("qwen".into(), old.clone());
        inner.applied.insert("xai".into(), old);
        inner.applied_revision = Some(0);
        inner.saved.credentials.clear();
        assert!(reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.is_err());
        assert_eq!(inner.snapshot().status, "pending");
        assert!(inner.applied.contains_key("qwen"));
        assert!(!inner.applied.contains_key("xai"));
        busy.store(false, Ordering::SeqCst);
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        assert!(inner.applied.is_empty());
        assert_eq!(inner.snapshot().status, "applied");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert!(calls.iter().all(|call| call["params"]["method"] == "providers/disable"));
    }

    #[test]
    fn only_the_adapter_busy_response_is_pending_and_raw_errors_stay_private() {
        let mut pending = false;
        let mut failures = Vec::new();
        record_application_error(
            "qwen",
            "apply",
            &ResponseError::new(-32600, "private-test-secret"),
            &mut pending,
            &mut failures,
        );
        assert!(!pending);
        assert_eq!(failures.len(), 1);
        assert!(!failures[0].contains("private-test-secret"));
        assert!(application_pending(PROVIDERS_PENDING));
        assert!(!application_pending(&failures[0]));
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
        let mut inner =
            Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None };
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        {
            let recorded = calls.lock().unwrap();
            let params = &recorded[0]["params"]["params"];
            let runtime_id = params["_meta"]["codex"]["id"].as_str().unwrap();
            assert!(runtime_id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'));
            assert_eq!(runtime_id, "custom-637573746f6d5f70726976617465");
            assert_eq!(params["baseUrl"], "https://gateway.example.test/v1");
            assert_eq!(params["_meta"]["codex"]["name"], "Private gateway");
            assert_eq!(params["_meta"]["codex"]["config"], json!({}));
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
        inner.saved = remove_custom(&inner.saved, "custom_private", 1).unwrap();
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        let calls = calls.lock().unwrap();
        assert_eq!(calls[1]["params"]["params"]["_meta"]["codex"]["id"], "custom-637573746f6d5f70726976617465");
    }

    #[tokio::test]
    async fn recognized_custom_models_receive_their_catalog_without_changing_routing() {
        let provider = CustomProvider {
            id: "custom_profile".into(),
            name: "Zhipu".into(),
            base_url: "https://open.bigmodel.cn/api/v1".into(),
            api_key: "private-test-secret".into(),
            models: vec![CustomModel {
                label: "My GLM".into(),
                api_id: "glm-5.3".into(),
                context_window: None,
                description: None,
            }],
        };
        let saved = Saved { custom_providers: BTreeMap::from([(provider.id.clone(), provider)]), ..Saved::default() };
        let (client, calls) = fake_runtime(
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut inner =
            Inner { managed_active: false, saved, applied: BTreeMap::new(), applied_revision: None, error: None };
        reconcile(&mut inner, &client, std::path::Path::new("/resources")).await.unwrap();
        let calls = calls.lock().unwrap();
        let params = &calls[0]["params"]["params"];
        assert_eq!(params["baseUrl"], "https://open.bigmodel.cn/api/v1");
        assert_eq!(params["_meta"]["alwith"]["models"][0]["id"], "glm-5.3");
        assert_eq!(params["_meta"]["alwith"]["models"][0]["label"], "My GLM");
        assert_eq!(params["_meta"]["codex"]["config"]["model_catalog_json"], "/resources/custom/models.json");
        assert_eq!(params["_meta"]["codex"]["config"]["web_search"], "disabled");
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
        assert_eq!(body, json!({"model":"model-a","input":"Reply with OK.","max_output_tokens":16,"store":false}));
    }
}

#[cfg(test)]
mod managed_tests {
    use super::*;

    #[test]
    fn account_provider_cannot_be_configured_with_a_manual_key() {
        assert_eq!(managed_definition()["source"], "account");
        assert!(definition(managed::ID).is_err());
        assert!(
            update(
                &Saved::default(),
                managed::ID.into(),
                Some(Input { api_key: Some("manual-key".into()), region: None, base_url: None }),
                0
            )
            .is_err()
        );
    }

    #[test]
    fn source_metadata_only_overrides_issued_models() {
        let mut models = json!([
            {"id":"deepseek-V4.1-flash","label":"Account name","contextWindow":123},
            {"id":"unknown","label":"Account-only model","contextWindow":456}
        ]);
        apply_managed_model_overrides(&mut models);
        assert_eq!(models.as_array().unwrap().len(), 2);
        assert_eq!(models[0]["id"], "deepseek-V4.1-flash");
        assert_eq!(models[0]["label"], "DeepSeek-Flash");
        assert_eq!(models[0]["contextWindow"], 1048576);
        assert_eq!(models[1], json!({"id":"unknown","label":"Account-only model","contextWindow":456}));
        let mut unissued = json!([]);
        apply_managed_model_overrides(&mut unissued);
        assert_eq!(unissued, json!([]));
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        assert!(bundled_model_catalogs(&root).unwrap().contains(&root.join("alwith/models.json")));
    }

    #[test]
    fn managed_catalog_filters_unissued_hidden_and_other_protocols() {
        let body = json!([
            {"provider_id":"litellm","name":"ALwith","base_url":"https://gateway.test/v1","api_key":"secret-key","hidden":false,"models":[{"api_id":"ds-pro","label":"DS Pro","context_window":1000000}]},
            {"provider_id":"openrouter","api_key":"other-secret"}
        ]);
        let provider = managed::parse_catalog(&body.to_string()).unwrap().unwrap();
        assert_eq!(provider.id, "litellm");
        assert_eq!(provider.models[0].context_window, Some(1000000));
        let mut hidden = body.clone();
        hidden[0]["hidden"] = json!(true);
        assert!(managed::parse_catalog(&hidden.to_string()).unwrap().is_none());
        hidden[0]["hidden"] = json!(false);
        hidden[0]["api_key"] = json!("  ");
        assert!(managed::parse_catalog(&hidden.to_string()).unwrap().is_none());
    }

    #[test]
    fn managed_cache_stays_private_and_user_edits_preserve_it() {
        let saved = Saved { managed: Some(managed::Cache {
            account: managed::Account { api_base_url: "https://api.alwith.ai/service".into(), user_uuid: "account-a".into() },
            provider: managed::parse_catalog(&json!([{"provider_id":"litellm","name":"ALwith","base_url":"https://gateway.test/v1","api_key":"private-model-key","hidden":false,"models":[{"api_id":"m","label":"Model"}]}]).to_string()).unwrap(),
        }), ..Saved::default() };
        let edited = update(
            &saved,
            "deepseek".into(),
            Some(Input { api_key: Some("user-key".into()), region: None, base_url: None }),
            0,
        )
        .unwrap();
        assert_eq!(edited.managed.as_ref().unwrap().account.user_uuid, "account-a");
        let mut inner = Inner {
            managed_active: false,
            saved: edited,
            applied: BTreeMap::new(),
            applied_revision: None,
            error: None,
        };
        assert!(inner.snapshot().managed_providers.is_empty());
        inner.managed_active = true;
        assert_eq!(inner.snapshot().managed_providers[0].models[0].api_id, "m");
        let snapshot = serde_json::to_string(&inner.snapshot()).unwrap();
        assert!(!snapshot.contains("private-model-key"));
        assert!(!snapshot.contains("user-key"));
        let legacy: Saved = serde_json::from_str(r#"{"revision":0,"credentials":{}}"#).unwrap();
        assert!(legacy.managed.is_none());
    }

    #[test]
    fn malformed_managed_catalog_never_echoes_keys_and_rejects_duplicate_models() {
        let body = json!([{"provider_id":"litellm","name":"ALwith","base_url":"https://gateway.test/v1","api_key":"private-secret","hidden":false,"models":[{"api_id":"same","label":"One"},{"api_id":"same","label":"Two"}]}]);
        let error = managed::parse_catalog(&body.to_string()).unwrap_err();
        assert!(!error.contains("private-secret"));
        assert!(managed::parse_catalog("not-json").is_err());
    }
}
