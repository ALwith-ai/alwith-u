//! U orchestrates enterprise authentication and the relay; shared chat owns provider storage and routing.
mod catalog;
mod gate;
mod runtime;
use alwith_enterprise_client::{EnterpriseClient, GATEWAY_URL, Protocol};
pub(crate) use runtime::{apply, check, observe, observe_event, observe_realtime, ready, reset, uses_enterprise};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex as AsyncMutex, OnceCell};

#[derive(Clone, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    environment: String,
    email: String,
    user_uuid: String,
}
impl Account {
    fn validate(&self) -> Result<(), &'static str> {
        if !matches!(self.environment.as_str(), "production" | "development")
            || self.user_uuid.trim().is_empty()
            || self.user_uuid.len() > 128
            || self.email.len() > 254
            || self.email.trim() != self.email
            || !self.email.contains('@')
        {
            return Err("Invalid ALwith account association");
        }
        Ok(())
    }
    fn identity(&self) -> String {
        json!([GATEWAY_URL, self.environment, self.user_uuid, self.email]).to_string()
    }
}
struct Binding {
    account: Account,
    epoch: u64,
    generation: u64,
}
#[derive(Default)]
pub struct Enterprise {
    host: OnceCell<Arc<EnterpriseClient>>,
    closing: Arc<AtomicBool>,
    gate: Mutex<gate::Gate>,
    binding: AsyncMutex<Option<Binding>>,
    refresh: AsyncMutex<()>,
    transition: AsyncMutex<()>,
    realtime: Mutex<BTreeSet<String>>,
    connection: Mutex<Option<catalog::Connection>>,
    ready_agents: Mutex<BTreeSet<String>>,
    configured: Mutex<BTreeMap<String, BTreeSet<String>>>,
    applied: Mutex<BTreeMap<String, Value>>,
    configuration: Arc<AsyncMutex<()>>,
}
fn error(message: impl ToString) -> Value {
    json!({"message":message.to_string()})
}
fn controls(window: &tauri::WebviewWindow) -> Result<(), Value> {
    if matches!(window.label(), "main" | "settings") {
        Ok(())
    } else {
        Err(error("Enterprise controls belong to account settings"))
    }
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), Value> {
    if window.label() == "main" { Ok(()) } else { Err(error("Enterprise account changes belong to the main window")) }
}
impl Enterprise {
    async fn host(&self, app: &AppHandle) -> Result<&Arc<EnterpriseClient>, Value> {
        self.host.get_or_try_init(|| async {
            let sessions = app.path().app_data_dir().map_err(error)?.join("enterprise-gateway-sessions.json");
            let directory = match crate::native::development_directory() {
                Some(directory) => directory,
                None => app.path().resource_dir().map_err(error)?.join("native"),
            };
            let host = Arc::new(EnterpriseClient::open_gateway(&directory, &sessions).await?);
            let events = host.clone();
            let closing = self.closing.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.next_event().await {
                        Ok(Value::Null) => break,
                        Ok(value) => {
                            if value["type"] == "enterpriseRequestTools" { continue; }
                            if let Err(reason) = app.emit("enterprise:event", value) { log::error!("Enterprise event delivery failed: {reason}"); }
                        }
                        Err(reason) => {
                            if closing.load(Ordering::Acquire) { break; }
                            log::error!("Enterprise event stream interrupted: {reason}");
                            let state = app.state::<Enterprise>();
                            if let Some(binding) = state.binding.lock().await.as_ref() {
                                let _ = app.emit("enterprise:event", json!({"type":"enterpriseEventStreamInterrupted","accountId":binding.account.user_uuid,"generation":binding.generation}));
                            }
                            if reason["kind"] != "event_lagged" { break; }
                        }
                    }
                }
            });
            Ok(host)
        }).await
    }
    fn changed(&self, app: &AppHandle) -> Result<(), Value> {
        app.emit("enterprise:models-changed", ()).map_err(error)?;
        let gate = self.gate.lock().unwrap();
        let sessions: Vec<_> = gate
            .routes
            .iter()
            .filter(|(id, _)| gate.check(None, Some(id.as_str())).is_err())
            .map(|(id, _)| id.clone())
            .collect();
        app.emit("providers:managed-revoked", json!({"sessionIds":sessions})).map_err(error)
    }
    async fn current(&self, generation: u64) -> Result<Arc<EnterpriseClient>, Value> {
        let binding = self.binding.lock().await;
        let Some(binding) = binding.as_ref() else {
            return Err(error("Enterprise account is not ready"));
        };
        let gate = self.gate.lock().unwrap();
        if binding.generation != generation || binding.epoch != gate.generation || gate.account.is_none() {
            return Err(error("ALwith account changed"));
        }
        Ok(self.host.get().expect("prepared enterprise client").clone())
    }
    pub async fn close(&self) -> Result<(), String> {
        self.closing.store(true, Ordering::Release);
        if let Some(host) = self.host.get() {
            host.close().await.map_err(|reason| reason.to_string())?;
        }
        Ok(())
    }
    async fn clear(&self, app: &AppHandle, explicit: bool) -> Result<(), Value> {
        self.gate.lock().unwrap().invalidate().map_err(error)?;
        *self.connection.lock().unwrap() = None;
        let notification = self.changed(app);
        // Invalidation precedes waits: late refreshes cannot restore this account's routes.
        let mut binding = self.binding.lock().await;
        let stopped = if let Some(bound) = binding.take() {
            let host = self.host.get().expect("prepared enterprise client");
            if explicit { host.logout(bound.generation).await } else { host.suspend(bound.generation).await }
        } else {
            Ok(())
        };
        drop(binding);
        let cleanup = runtime::cleanup(app).await;
        stopped?;
        cleanup?;
        notification
    }
}

#[tauri3_specta::command]
pub async fn enterprise_bind(window: tauri::WebviewWindow, account: Account) -> Result<u64, Value> {
    main_window(&window)?;
    account.validate().map_err(error)?;
    let state = window.state::<Enterprise>();
    let _transition = state.transition.lock().await;
    let identity = account.identity();
    let changed = state.gate.lock().unwrap().account.as_ref() != Some(&identity);
    if changed {
        state.clear(window.app_handle(), false).await?;
    }
    let generation = state.gate.lock().unwrap().bind(identity).map_err(error)?;
    state.changed(window.app_handle())?;
    Ok(generation)
}

#[tauri3_specta::command]
pub async fn enterprise_refresh(
    window: tauri::WebviewWindow, account: Account, generation: u64, model_labels: BTreeMap<String, String>,
) -> Result<Value, Value> {
    main_window(&window)?;
    let app = window.app_handle();
    let state = app.state::<Enterprise>();
    let _refresh = state.refresh.lock().await;
    let identity = account.identity();
    let check = || {
        let gate = state.gate.lock().unwrap();
        if gate.generation != generation || gate.account.as_ref() != Some(&identity) {
            Err(error("ALwith account changed"))
        } else {
            Ok(())
        }
    };
    check()?;
    account.validate().map_err(error)?;
    let host = state.host(app).await?;
    let native_generation = {
        let mut binding = state.binding.lock().await;
        check()?;
        let native_generation = host
            .prepare_gateway(
                GATEWAY_URL.into(),
                account.user_uuid.clone(),
                account.email.clone(),
                account.environment.clone(),
                "alwith-u".into(),
            )
            .await?;
        if let Err(reason) = check() {
            host.suspend(native_generation).await?;
            return Err(reason);
        }
        *binding = Some(Binding { account: account.clone(), epoch: generation, generation: native_generation });
        native_generation
    };
    let result = async {
        let status = host.ensure(native_generation).await?;
        if status["automatic_renewal"] != true {
            return Ok(None);
        }
        let catalog = host.providers(native_generation).await?;
        check()?;
        let Some(mut provider) = catalog::parse(catalog).map_err(error)? else { return Ok(None) };
        catalog::apply_labels(&mut provider, &model_labels).map_err(error)?;
        if provider.base_url.trim_end_matches('/') != GATEWAY_URL {
            return Err(error("Enterprise catalog gateway does not match the configured gateway"));
        }
        let gateway = provider.base_url.clone();
        let relay = host.relay(native_generation, gateway, Protocol::Responses).await?;
        Ok::<_, Value>(Some(
            catalog::connection(app, &identity, provider, relay, host, native_generation).await.map_err(error)?,
        ))
    }
    .await;
    check()?;
    let models = result
        .as_ref()
        .ok()
        .and_then(|connection| connection.as_ref())
        .map(|connection| {
            connection
                .provider
                .models
                .iter()
                .map(|model| catalog::model_id(&connection.provider.id, &model.api_id))
                .collect()
        })
        .unwrap_or_default();
    {
        let mut gate = state.gate.lock().unwrap();
        gate.commit(generation, models).map_err(error)?;
        *state.connection.lock().unwrap() =
            result.as_ref().ok().and_then(|connection| connection.as_ref()).map(|connection| catalog::Connection {
                provider: connection.provider.clone(),
                params: connection.params.clone(),
            });
    }
    let notification = state.changed(app);
    runtime::cleanup(app).await?;
    result?;
    runtime::apply_ready(app).await;
    notification?;
    Ok(Value::Null)
}

#[tauri3_specta::command]
pub async fn enterprise_catalog(window: tauri::WebviewWindow) -> Value {
    let state = window.state::<Enterprise>();
    let gate = state.gate.lock().unwrap();
    match state.connection.lock().unwrap().as_ref() {
        Some(connection) if gate.account.is_some() && !gate.models.is_empty() => {
            serde_json::to_value(&connection.provider).expect("public enterprise catalog")
        }
        _ => Value::Null,
    }
}

#[tauri3_specta::command]
pub async fn enterprise_clear(window: tauri::WebviewWindow) -> Result<(), Value> {
    main_window(&window)?;
    let state = window.state::<Enterprise>();
    state.gate.lock().unwrap().invalidate().map_err(error)?;
    if let Err(reason) = state.changed(window.app_handle()) {
        log::error!("Enterprise revocation notification failed: {reason}");
    }
    let _transition = state.transition.lock().await;
    state.clear(window.app_handle(), false).await
}
#[tauri3_specta::command]
pub async fn enterprise_status(window: tauri::WebviewWindow) -> Result<Value, Value> {
    let state = window.state::<Enterprise>();
    let generation = {
        let binding = state.binding.lock().await;
        let Some(binding) = binding.as_ref() else {
            return Ok(
                json!({"enabled":true,"authorization_status":"unauthorized","automatic_renewal":false,"requires_login":false,"error":null}),
            );
        };
        binding.generation
    };
    state.current(generation).await?.status(generation).await
}
#[tauri3_specta::command]
pub async fn enterprise_begin(window: tauri::WebviewWindow, generation: u64) -> Result<Value, Value> {
    controls(&window)?;
    window.state::<Enterprise>().current(generation).await?.begin_browser(generation).await
}
#[tauri3_specta::command]
pub async fn enterprise_cancel(window: tauri::WebviewWindow, generation: u64, state: String) -> Result<(), Value> {
    controls(&window)?;
    window.state::<Enterprise>().current(generation).await?.cancel(generation, state).await
}
#[tauri3_specta::command]
pub async fn enterprise_logout(window: tauri::WebviewWindow, generation: u64) -> Result<(), Value> {
    controls(&window)?;
    let app = window.app_handle();
    let state = window.state::<Enterprise>();
    let _transition = state.transition.lock().await;
    state.current(generation).await?;
    state.clear(app, true).await
}

#[cfg(test)]
#[path = "enterprise/__tests__/native.rs"]
mod native_tests;
