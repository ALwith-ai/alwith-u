//! Application integration for the shared enterprise source library.
use super::*;
use alwith_enterprise_core::{Host, Protocol};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{Mutex, OnceCell};

fn enterprise_error(error: impl std::fmt::Display) -> Value {
    json!({"message":error.to_string()})
}

#[derive(Default)]
pub(crate) struct Enterprise {
    host: OnceCell<Arc<Host>>,
    binding: Mutex<Option<(managed::Account, u64, u64, String)>>,
    pub revision: std::sync::atomic::AtomicU64,
}

impl Enterprise {
    async fn host(&self, app: &AppHandle) -> Result<&Arc<Host>, Value> {
        self.host.get_or_try_init(|| async {
            let path = app.path().app_data_dir().map_err(|_| json!({"message":"Enterprise storage unavailable"}))?.join("enterprise-settings.json");
            let host = Arc::new(Host::new(path));
            let mut events = host.subscribe();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(value) => {
                            if value["type"] == "enterpriseRequestTools" {
                                log::info!("Enterprise request tools: model={} tools={} remoteReferenceTypes={}", value["model"], value["tools"], value["remoteReferenceTypes"]);
                                continue;
                            }
                            if let Err(error) = app.emit("enterprise:event", value) { log::error!("Enterprise event delivery failed: {error}"); }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            let providers = app.state::<Providers>();
                            let binding = providers.enterprise.binding.lock().await;
                            if let Some((account, generation, _, _)) = binding.as_ref() {
                                let _ = app.emit("enterprise:event", json!({"type":"enterpriseEventStreamInterrupted","accountId":account.user_uuid,"generation":generation}));
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
            Ok(host)
        }).await
    }

    pub async fn close(&self) -> Result<(), String> {
        if let Some(host) = self.host.get() {
            host.close().await?;
        }
        Ok(())
    }

    pub async fn prepare(
        &self, app: &AppHandle, account: &managed::Account, account_generation: u64, token: String,
    ) -> Result<u64, Value> {
        let client = self.host(app).await?;
        let mut binding = self.binding.lock().await;
        if app.state::<Providers>().managed.gate.lock().unwrap().generation != account_generation {
            return Err(json!({"message":"ALwith account changed"}));
        }
        let generation = client.prepare(account.api_base_url.clone(), account.user_uuid.clone(), token.clone()).await?;
        let current = app.state::<Providers>().managed.gate.lock().unwrap().account.clone();
        if current.as_ref() != Some(account)
            || app.state::<Providers>().managed.gate.lock().unwrap().generation != account_generation
        {
            client.suspend(generation).await?;
            *binding = None;
            return Err(json!({"message":"ALwith account changed during enterprise preparation"}));
        }
        *binding = Some((account.clone(), generation, account_generation, token));
        Ok(generation)
    }

    pub(super) async fn provider(
        &self, app: &AppHandle, generation: u64, mut provider: CustomProvider,
    ) -> Result<Option<CustomProvider>, Value> {
        let client = self.host(app).await?;
        let account = client.account(generation).await.map_err(enterprise_error)?;
        account.ensure().await.map_err(enterprise_error)?;
        let status = client.status(generation).await.map_err(enterprise_error)?;
        if status["automatic_renewal"] != true {
            return Ok(None);
        }
        let relay = client.relay(generation, provider.base_url, Protocol::Responses).await?;
        provider.base_url =
            relay["baseUrl"].as_str().ok_or_else(|| json!({"message":"Invalid enterprise relay URL"}))?.to_owned();
        provider.api_key = relay["apiKey"]
            .as_str()
            .ok_or_else(|| json!({"message":"Invalid enterprise relay capability"}))?
            .to_owned();
        Ok(Some(provider))
    }

    pub async fn clear(&self) -> Result<(), Value> {
        let mut binding = self.binding.lock().await;
        if let Some((_, generation, _, _)) = binding.as_ref() {
            self.host.get().expect("bound enterprise client").suspend(*generation).await?;
        }
        *binding = None;
        Ok(())
    }

    pub async fn cleanup_revoked(&self, app: &AppHandle) -> Result<(), Value> {
        let runtime = app.state::<crate::runtime::RuntimeState>();
        let _admission = runtime.admission.lock().await;
        let Ok(client) = runtime.current() else { return Ok(()) };
        let providers = app.state::<Providers>();
        let (routes, realtime) = {
            let gate = providers.managed.gate.lock().unwrap();
            (
                gate.routes
                    .iter()
                    .filter(|(_, route)| route.revoked && route.model.starts_with(managed::ENTERPRISE_PREFIX))
                    .map(|(id, route)| (id.clone(), route.clone()))
                    .collect::<Vec<_>>(),
                gate.realtime.clone(),
            )
        };
        let active: BTreeSet<String> = client
            .run_states()
            .await
            .map_err(|_| json!({"message":"Enterprise run state unavailable"}))?
            .into_iter()
            .filter(|s| matches!(s.state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction))
            .map(|s| s.session_id)
            .collect();
        for (id, route) in routes {
            if let Some(agent) = realtime.get(&id) {
                client
                    .acp_request(agent, "_codex/realtime/stop", json!({"sessionId":id}), None, None)
                    .await
                    .map_err(|_| json!({"message":"Enterprise realtime cleanup failed"}))?;
                providers.managed.gate.lock().unwrap().realtime.remove(&id);
            }
            if !active.contains(&id) {
                continue;
            }
            client
                .cancel(&route.agent, &id, None)
                .await
                .map_err(|_| json!({"message":"Enterprise session cleanup failed"}))?;
        }
        Ok(())
    }

    async fn current(&self, app: &AppHandle) -> Result<(Arc<Host>, u64), Value> {
        let providers = app.state::<Providers>();
        let account = providers.managed.gate.lock().unwrap().account.clone();
        let binding = self.binding.lock().await;
        let Some((bound, generation, account_generation, _)) = binding.as_ref() else {
            return Err(json!({"message":"Enterprise account is not ready"}));
        };
        if account.as_ref() != Some(bound) || providers.managed.gate.lock().unwrap().generation != *account_generation {
            return Err(json!({"message":"ALwith account changed"}));
        }
        Ok((self.host.get().expect("bound enterprise client").clone(), *generation))
    }
}

#[tauri3_specta::command]
pub async fn enterprise_status(window: tauri::WebviewWindow) -> Result<Value, Value> {
    let app = window.app_handle();
    let providers = app.state::<Providers>();
    if providers.enterprise.binding.lock().await.is_none() {
        return Ok(json!({"automatic_renewal":false,"requires_login":false,"error":null}));
    }
    let (client, generation) = providers.enterprise.current(app).await?;
    client.status(generation).await.map_err(enterprise_error)
}

#[tauri3_specta::command]
pub async fn enterprise_begin(window: tauri::WebviewWindow, generation: u64) -> Result<Value, Value> {
    if !matches!(window.label(), "main" | "settings") {
        return Err(json!({"message":"Enterprise controls belong to account settings"}));
    }
    let app = window.app_handle();
    let providers = app.state::<Providers>();
    let (client, current_generation) = providers.enterprise.current(app).await?;
    if generation != current_generation {
        return Err(json!({"message":"Enterprise account changed"}));
    }
    client.begin_browser(generation).await.map_err(enterprise_error)
}

#[tauri3_specta::command]
pub async fn enterprise_cancel(window: tauri::WebviewWindow, generation: u64, state: String) -> Result<(), Value> {
    if !matches!(window.label(), "main" | "settings") {
        return Err(json!({"message":"Enterprise controls belong to account settings"}));
    }
    let app = window.app_handle();
    let providers = app.state::<Providers>();
    let (client, current_generation) = providers.enterprise.current(app).await?;
    if generation != current_generation {
        return Err(json!({"message":"Enterprise account changed"}));
    }
    client.cancel(generation, &state).await.map_err(enterprise_error)
}

#[tauri3_specta::command]
pub async fn enterprise_update_account(
    window: tauri::WebviewWindow, generation: u64, request_id: String, access_token: String,
) -> Result<(), Value> {
    if window.label() != "main" {
        return Err(json!({"message":"Account refresh belongs to the main window"}));
    }
    let app = window.app_handle();
    let providers = app.state::<Providers>();
    let (client, current_generation) = providers.enterprise.current(app).await?;
    if generation != current_generation {
        return Err(json!({"message":"Enterprise account changed"}));
    }
    client.update(generation, request_id, access_token.clone()).await?;
    let mut binding = providers.enterprise.binding.lock().await;
    let Some((_, bound_generation, _, token)) = binding.as_mut() else {
        return Err(json!({"message":"Enterprise account changed"}));
    };
    if *bound_generation != generation {
        return Err(json!({"message":"Enterprise account changed"}));
    }
    *token = access_token;
    Ok(())
}

#[tauri3_specta::command]
pub async fn enterprise_logout(window: tauri::WebviewWindow, generation: u64) -> Result<(), Value> {
    if !matches!(window.label(), "main" | "settings") {
        return Err(json!({"message":"Enterprise controls belong to account settings"}));
    }
    let app = window.app_handle();
    let providers = app.state::<Providers>();
    let _transition = providers.managed.transition.lock().await;
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let admission = runtime.admission.lock().await;
    let (_, current_generation) = providers.enterprise.current(app).await?;
    if generation != current_generation {
        return Err(json!({"message":"Enterprise account changed"}));
    }
    providers.enterprise.revision.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let (base, token) = {
        let binding = providers.enterprise.binding.lock().await;
        let (account, _, _, token) = binding.as_ref().expect("validated binding");
        (account.api_base_url.clone(), token.clone())
    };
    let routes = {
        let mut gate = providers.managed.gate.lock().unwrap();
        for route in gate.routes.values_mut() {
            if route.model.starts_with(managed::ENTERPRISE_PREFIX) {
                route.revoked = true;
            }
        }
        gate.models.retain(|model| !model.starts_with(managed::ENTERPRISE_PREFIX));
        gate.routes
            .iter()
            .filter(|(_, route)| route.model.starts_with(managed::ENTERPRISE_PREFIX))
            .map(|(id, route)| (id.clone(), route.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    {
        let mut binding = providers.enterprise.binding.lock().await;
        if let Some((_, generation, _, _)) = binding.as_ref() {
            providers.enterprise.host.get().expect("bound enterprise client").logout(*generation).await?;
        }
        *binding = None;
    }
    {
        let mut inner = providers.inner.lock().await;
        if let Some(cache) = inner.saved.managed.as_mut() {
            cache.enterprise = None;
        }
        inner.saved.revision =
            inner.saved.revision.checked_add(1).ok_or_else(|| json!({"message":"Provider revision exhausted"}))?;
        inner.applied_revision = None;
        persist(&providers.path, &inner.saved).map_err(|_| json!({"message":"Cannot save enterprise logout"}))?;
        inner.snapshot().emit(app).map_err(|_| json!({"message":"Cannot notify enterprise logout"}))?;
    }
    app.emit("providers:managed-revoked", json!({"sessionIds":routes.keys().collect::<Vec<_>>()}))
        .map_err(|_| json!({"message":"Cannot notify enterprise revocation"}))?;
    if !routes.is_empty() {
        let runtime = app.state::<crate::runtime::RuntimeState>();
        let client =
            runtime.current().map_err(|_| json!({"message":"Runtime unavailable during enterprise cleanup"}))?;
        let realtime = providers.managed.gate.lock().unwrap().realtime.clone();
        let active: BTreeSet<String> = client
            .run_states()
            .await
            .map_err(|_| json!({"message":"Enterprise run state unavailable"}))?
            .into_iter()
            .filter(|s| matches!(s.state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction))
            .map(|s| s.session_id)
            .collect();
        for (id, route) in &routes {
            if let Some(agent) = realtime.get(id) {
                client
                    .acp_request(agent, "_codex/realtime/stop", json!({"sessionId":id}), None, None)
                    .await
                    .map_err(|_| json!({"message":"Enterprise realtime cleanup failed"}))?;
                providers.managed.gate.lock().unwrap().realtime.remove(id);
            }
            if !active.contains(id) {
                continue;
            }
            client
                .cancel(&route.agent, id, None)
                .await
                .map_err(|_| json!({"message":"Enterprise session cleanup failed"}))?;
        }
    }
    drop(admission);
    schedule_apply(app);
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| json!({"message":"Enterprise logout unavailable"}))?;
    let response = http
        .delete(format!("{base}/api/v1/me/enterprise/finture"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| json!({"message":"Remote enterprise logout failed; local access is revoked"}))?;
    if !response.status().is_success() {
        return Err(json!({"message":"Remote enterprise logout failed; local access is revoked"}));
    }
    Ok(())
}

#[cfg(test)]
#[path = "__tests__/enterprise.rs"]
mod tests;
