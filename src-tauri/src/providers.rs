//! Application-owned provider credentials. Webviews receive only configured/region metadata.
//! A persisted revision becomes active only at an idle boundary under Runtime admission.
use alwith_api::{RunState, RuntimeClient};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};

const EVENT: &str = "providers:changed";
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Credential {
    api_key: String,
    region: Option<String>,
}
#[derive(Default, Deserialize, Serialize)]
struct Saved {
    revision: u64,
    credentials: BTreeMap<String, Credential>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    applied_revision: Option<u64>,
    providers: BTreeMap<String, Metadata>,
    status: &'static str,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Metadata {
    configured: bool,
    region: Option<String>,
}
struct Inner {
    saved: Saved,
    applied: BTreeMap<String, Credential>,
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
                .map(|(id, key)| (id.clone(), Metadata { configured: true, region: key.region.clone() }))
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
        credentials.insert(id, Credential { api_key, region });
    } else {
        credentials.remove(&id);
    }
    Ok(Saved { revision: saved.revision.checked_add(1).ok_or("Provider revision exhausted")?, credentials })
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
    let desired = inner.saved.credentials.clone();
    let outcome: Result<(), String> = async {
        for (id, key) in &desired {
            if inner.applied.get(id) == Some(key) { continue; }
            let provider = definition(id)?;
            let base_url = match key.region.as_deref() {
                Some(region) => provider["regions"].as_array().and_then(|regions| regions.iter().find(|r| r["id"] == region)).map(|r| r["baseUrl"].clone()).ok_or("Unknown provider region")?,
                None => provider["baseUrl"].clone(),
            };
            let mut config = provider.get("config").cloned().unwrap_or(json!({}));
            if let Some(catalog) = provider["catalog"].as_str() {
                config["model_catalog_json"] = json!(resource_dir.join(catalog));
            }
            client.acp_request("codex", "providers/set", json!({"providerId":"openai", "apiType":"openai", "baseUrl":base_url,
                "_meta":{"codex":{"id":id,"name":provider["name"],"mode":"catalog","bearerToken":key.api_key,"config":config}, "alwith":{"models":provider["models"]}}}), None, None)
                .await.map_err(|e| format!("Provider {id} could not be applied ({}); retry at an idle boundary", e.code))?;
            inner.applied.insert(id.clone(), key.clone());
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn region_change_preserves_private_key_and_public_snapshot_never_contains_it() {
        let saved = update(
            &Saved::default(),
            "qwen".into(),
            Some(Input { api_key: Some("private-test-secret".into()), region: Some("intl".into()) }),
            0,
        )
        .unwrap();
        let saved = update(&saved, "qwen".into(), Some(Input { api_key: None, region: Some("cn".into()) }), 1).unwrap();
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
                Some(Input { api_key: Some("test".into()), region: Some("invalid".into()) }),
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
        let saved =
            update(&Saved::default(), "deepseek".into(), Some(Input { api_key: Some("test".into()), region: None }), 0)
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

    fn pending_provider() -> Inner {
        let saved = update(
            &Saved::default(),
            "qwen".into(),
            Some(Input { api_key: Some("private-test-secret".into()), region: Some("cn".into()) }),
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
        inner.saved =
            update(&inner.saved, "qwen".into(), Some(Input { api_key: None, region: Some("intl".into()) }), 1).unwrap();
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
}
