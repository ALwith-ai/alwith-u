//! Account-owned gateway configuration and revocation. Secrets never cross the webview boundary.
use super::*;
use std::sync::Mutex;
use std::time::Duration;

pub const ID: &str = "litellm";
const MODEL_PREFIX: &str = "gateway:litellm:";

#[derive(Clone, Serialize, specta::Type, tauri3_specta::Event)]
#[serde(rename_all = "camelCase")]
#[event(name = "providers:managed-revoked")]
pub struct RevokedSessions {
    session_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct Cache {
    pub account: Account,
    pub provider: Option<CustomProvider>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub api_base_url: String,
    pub user_uuid: String,
}
#[derive(Default)]
pub(super) struct Gate {
    pub generation: u64,
    pub account: Option<Account>,
    pub targets: BTreeSet<String>,
    pub routes: BTreeMap<String, Route>,
    pub models: BTreeSet<String>,
    pub realtime: BTreeMap<String, String>,
}
#[derive(Clone)]
pub(super) struct Route {
    pub model: String,
    pub agent: String,
    pub generation: u64,
}
impl Gate {
    fn invalidate(&mut self) -> Result<(), String> {
        self.generation = self.generation.checked_add(1).ok_or("Account generation exhausted")?;
        self.account = None;
        self.models.clear();
        Ok(())
    }
    fn check_selection(&self, requested: Option<&str>, session: Option<&str>) -> Result<(), String> {
        if let Some(model) = requested
            && model.starts_with(MODEL_PREFIX)
            && (self.account.is_none() || !self.models.contains(model))
        {
            return Err("The selected ALwith account model is unavailable".into());
        }
        if let Some(route) = session.and_then(|session| self.routes.get(session))
            && (self.account.is_none() || route.generation != self.generation || !self.models.contains(&route.model))
        {
            return Err("The ALwith account changed. Select a model before sending".into());
        }
        Ok(())
    }
}
fn model_ids(provider: Option<&CustomProvider>) -> BTreeSet<String> {
    provider
        .into_iter()
        .flat_map(|provider| provider.models.iter())
        .map(|model| {
            let encoded: String = url_model_id(&model.api_id);
            format!("{MODEL_PREFIX}{encoded}")
        })
        .collect()
}
fn url_model_id(id: &str) -> String {
    // encodeURIComponent's unescaped bytes, matching gatewayModelId in the adapter.
    id.as_bytes()
        .iter()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(byte) {
                (*byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
#[derive(Default)]
pub(super) struct State {
    pub gate: Mutex<Gate>,
    pub transition: tokio::sync::Mutex<()>,
    pub refresh: tokio::sync::Mutex<()>,
}

#[derive(Deserialize)]
struct IssuedProvider {
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    hidden: bool,
    models: Vec<IssuedModel>,
}
#[derive(Deserialize)]
struct IssuedModel {
    api_id: String,
    label: String,
    context_window: Option<u64>,
    description: Option<String>,
}

pub(super) fn parse_catalog(body: &str) -> Result<Option<CustomProvider>, String> {
    let rows: Vec<Value> = serde_json::from_str(body).map_err(|_| "Invalid ALwith provider response")?;
    let mut selected = rows.into_iter().filter(|row| row["provider_id"] == ID);
    let Some(value) = selected.next() else { return Ok(None) };
    if selected.next().is_some() {
        return Err("Duplicate ALwith provider".into());
    }
    if value["api_key"].as_str().is_none_or(|key| key.trim().is_empty()) {
        return Ok(None);
    }
    let provider: IssuedProvider = serde_json::from_value(value).map_err(|_| "Invalid ALwith provider metadata")?;
    if provider.hidden {
        return Ok(None);
    }
    let mut ids = BTreeSet::new();
    let models = provider
        .models
        .into_iter()
        .map(|model| {
            if model.api_id.trim().is_empty()
                || model.label.trim().is_empty()
                || model.context_window == Some(0)
                || !ids.insert(model.api_id.clone())
            {
                return Err("Invalid or duplicate ALwith model metadata".to_string());
            }
            Ok(CustomModel {
                api_id: model.api_id,
                label: model.label,
                context_window: model.context_window,
                description: model.description,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if models.is_empty() {
        return Ok(None);
    }
    if provider.name.trim().is_empty() {
        return Err("Missing ALwith provider name".into());
    }
    Ok(Some(CustomProvider {
        id: ID.into(),
        name: provider.name,
        base_url: responses_base_url(&provider.base_url)?,
        models,
        api_key: provider.api_key,
    }))
}

fn responses_base_url(raw: &str) -> Result<String, String> {
    // Account-issued gateways may use internal HTTP, as in the supported /v1/responses contract.
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "Invalid ALwith gateway URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid ALwith gateway URL".into());
    }
    let base = url.as_str().trim_end_matches('/').to_string();
    match url.path().trim_end_matches('/') {
        "" => Ok(format!("{base}/v1")),
        path if path.ends_with("/v1") => Ok(base),
        _ => Err("ALwith gateway must supply a root URL or an API base ending in /v1".into()),
    }
}

fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("ALwith account changes belong to the main window".into());
    }
    Ok(())
}
fn validate_account(account: &Account) -> Result<(), String> {
    if !matches!(account.api_base_url.as_str(), "https://api.alwith.ai/service" | "https://api-dev.alwith.ai/service")
        || account.user_uuid.trim().is_empty()
    {
        return Err("Invalid ALwith account identity".into());
    }
    Ok(())
}

#[tauri3_specta::command]
pub async fn providers_account_bind(window: tauri::WebviewWindow, account: Account) -> Result<u64, String> {
    main_window(&window)?;
    validate_account(&account)?;
    let app = window.app_handle();
    let state = app.state::<Providers>();
    let _transition = state.managed.transition.lock().await;
    let mut inner = state.inner.lock().await;
    let generation = {
        let mut gate = state.managed.gate.lock().unwrap();
        if gate.account.as_ref() == Some(&account) {
            return Ok(gate.generation);
        }
        if !gate.targets.is_empty() {
            return Err("Previous ALwith provider cleanup is incomplete; retry logout".into());
        }
        gate.generation = gate.generation.checked_add(1).ok_or("Account generation exhausted")?;
        gate.account = Some(account.clone());
        gate.generation
    };
    inner.managed_active = inner.saved.managed.as_ref().is_some_and(|cache| cache.account == account);
    state.managed.gate.lock().unwrap().models = if inner.managed_active {
        model_ids(inner.saved.managed.as_ref().and_then(|cache| cache.provider.as_ref()))
    } else {
        BTreeSet::new()
    };
    inner.applied_revision = None;
    let _ = inner.snapshot().emit(app);
    Ok(generation)
}

#[tauri3_specta::command]
pub async fn providers_refresh_managed(
    window: tauri::WebviewWindow, generation: u64, access_token: String,
) -> Result<Snapshot, Value> {
    main_window(&window).map_err(|message| json!({"message":message}))?;
    let app = window.app_handle();
    let state = app.state::<Providers>();
    let _refresh = state.managed.refresh.lock().await;
    let account = {
        let gate = state.managed.gate.lock().unwrap();
        if gate.generation != generation {
            return Err(json!({"message":"ALwith account changed"}));
        }
        gate.account.clone().ok_or_else(|| json!({"message":"Sign in before loading ALwith models"}))?
    };
    if access_token.trim().is_empty() {
        return Err(json!({"message":"Missing ALwith access token"}));
    }
    let result = fetch_catalog(&account.api_base_url, &access_token).await;
    let mut inner = state.inner.lock().await;
    {
        let mut gate = state.managed.gate.lock().unwrap();
        if gate.generation != generation || gate.account.as_ref() != Some(&account) {
            return Err(json!({"message":"ALwith account changed during refresh"}));
        }
        let provider = match result {
            Ok(provider) => provider,
            Err(error) => {
                inner.error = Some("ALwith model configuration refresh failed".into());
                let _ = inner.snapshot().emit(app);
                return Err(error);
            }
        };
        let mut next = inner.saved.clone();
        next.managed = Some(Cache { account, provider });
        next.revision = next.revision.checked_add(1).ok_or_else(|| json!({"message":"Provider revision exhausted"}))?;
        persist(&state.path, &next).map_err(|_| json!({"message":"Cannot save ALwith model configuration"}))?;
        gate.models = model_ids(next.managed.as_ref().and_then(|cache| cache.provider.as_ref()));
        let _ = RevokedSessions {
            session_ids: gate
                .routes
                .iter()
                .filter(|(_, route)| !gate.models.contains(&route.model))
                .map(|(id, _)| id.clone())
                .collect(),
        }
        .emit(app);
        inner.saved = next;
        inner.managed_active = true;
        inner.error = None;
    }
    let snapshot = inner.snapshot();
    let _ = snapshot.emit(app);
    drop(inner);
    schedule_apply(app);
    Ok(snapshot)
}

async fn fetch_catalog(base: &str, token: &str) -> Result<Option<CustomProvider>, Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| json!({"message":"Cannot create ALwith configuration client"}))?;
    let response = client
        .get(format!("{base}/api/v1/providers"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| json!({"message":"ALwith configuration request failed"}))?;
    if !response.status().is_success() {
        return Err(json!({"status":response.status().as_u16(),"message":"ALwith configuration request rejected"}));
    }
    let body = response.text().await.map_err(|_| json!({"message":"Cannot read ALwith configuration response"}))?;
    parse_catalog(&body).map_err(|message| json!({"message":message}))
}

#[tauri3_specta::command]
pub async fn providers_clear_managed(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    clear(window.app_handle()).await
}

pub(super) async fn clear(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Providers>();
    // Invalidate before waiting for any network operation or admission lock.
    {
        let mut gate = state.managed.gate.lock().unwrap();
        gate.invalidate()?;
        let _ = RevokedSessions { session_ids: gate.routes.keys().cloned().collect() }.emit(app);
    }
    let _transition = tokio::time::timeout(Duration::from_secs(10), state.managed.transition.lock())
        .await
        .map_err(|_| "ALwith account transition did not settle; cleanup is incomplete")?;
    state.managed.gate.lock().unwrap().invalidate()?;
    let saved_error = {
        let mut inner = tokio::time::timeout(Duration::from_secs(10), state.inner.lock())
            .await
            .map_err(|_| "ALwith provider configuration did not settle; cleanup is incomplete")?;
        inner.managed_active = false;
        inner.applied_revision = None;
        inner.saved.managed = None;
        inner.saved.revision = inner.saved.revision.checked_add(1).ok_or("Provider revision exhausted")?;
        let error = persist(&state.path, &inner.saved).err();
        let _ = inner.snapshot().emit(app);
        error
    };
    let cleanup = cleanup(app).await;
    if let Some(error) = saved_error {
        return Err(error);
    }
    cleanup
}

pub(super) async fn cleanup(app: &AppHandle) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(30), cleanup_inner(app))
        .await
        .map_err(|_| "ALwith provider cleanup timed out; execution remains blocked")?
}

async fn cleanup_inner(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Providers>();
    {
        let gate = state.managed.gate.lock().unwrap();
        if gate.account.is_some() || gate.targets.is_empty() {
            return Ok(());
        }
    }
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let client = runtime.current().map_err(|_| "Runtime unavailable; ALwith cleanup is unconfirmed")?;
    // Drain accepted lifecycle/configuration operations before taking the cancellation snapshot.
    // New requests see the invalid gate. Never hold admission while waiting for turn termination.
    let admission = tokio::time::timeout(Duration::from_secs(10), runtime.admission.lock())
        .await
        .map_err(|_| "ALwith request admission did not settle")?;
    let (targets, routes, realtime) = {
        let gate = state.managed.gate.lock().unwrap();
        (gate.targets.clone(), gate.routes.clone(), gate.realtime.clone())
    };
    drop(admission);
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        for (session, agent) in &realtime {
            client
                .acp_request(agent, "_codex/realtime/stop", json!({"sessionId":session}), None, None)
                .await
                .map_err(|error| format!("ALwith Runtime cleanup failed ({})", error.code))?;
            state.managed.gate.lock().unwrap().realtime.remove(session);
        }
        for session in
            client.run_states().await.map_err(|error| format!("ALwith Runtime cleanup failed ({})", error.code))?
        {
            if matches!(session.state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction)
                && let Some(route) = routes.get(&session.session_id)
            {
                client
                    .cancel(&route.agent, &session.session_id, None)
                    .await
                    .map_err(|error| format!("ALwith Runtime cleanup failed ({})", error.code))?;
            }
        }
        loop {
            let active =
                client.run_states().await.map_err(|error| format!("ALwith Runtime cleanup failed ({})", error.code))?;
            if !active.iter().any(|session| {
                routes.contains_key(&session.session_id)
                    && matches!(session.state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction)
            }) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|_| "ALwith turn cancellation timed out".to_string())
    .and_then(|result| result);
    if let Err(error) = result {
        // Dedicated Gamepad agents can be stopped without interrupting unrelated main conversations.
        for target in targets.iter().filter(|target| target.starts_with("gamepad-config-")) {
            if stop_dedicated(&client, target).await
                && runtime.current().is_ok_and(|current| Arc::ptr_eq(&current, &client))
            {
                state.managed.gate.lock().unwrap().targets.remove(target);
            }
        }
        return Err(error);
    }
    for target in targets {
        let live = client.agents().await.map_err(|error| format!("ALwith Runtime cleanup failed ({})", error.code))?;
        if live.iter().any(|agent| agent["agentId"] == target) {
            let removed = tokio::time::timeout(
                Duration::from_secs(10),
                client.acp_request(
                    &target,
                    "providers/disable",
                    json!({"providerId":"openai","_meta":{"codex":{"id":ID}}}),
                    None,
                    None,
                ),
            )
            .await;
            if !matches!(removed, Ok(Ok(_))) && !stop_dedicated(&client, &target).await {
                return Err("ALwith provider cleanup is incomplete; wait for active sessions and retry".into());
            }
        }
        // A stale Runtime cannot acknowledge cleanup for its replacement.
        if !runtime.current().is_ok_and(|current| Arc::ptr_eq(&current, &client)) {
            return Err("Runtime changed during ALwith cleanup".into());
        }
        state.managed.gate.lock().unwrap().targets.remove(&target);
        if target == "codex" {
            let mut inner = state.inner.lock().await;
            inner.applied.remove(ID);
            inner.applied_revision = None;
        }
    }
    Ok(())
}

async fn stop_dedicated(client: &RuntimeClient, target: &str) -> bool {
    if !target.starts_with("gamepad-config-") {
        return false;
    }
    matches!(
        tokio::time::timeout(Duration::from_secs(5), async {
            client.stop(target, None).await?;
            let live = client.agents().await?;
            Ok::<bool, ResponseError>(!live.iter().any(|agent| agent["agentId"] == target))
        })
        .await,
        Ok(Ok(true))
    )
}

pub(super) fn selected_model(value: &Value) -> Option<&str> {
    value
        .get("configOptions")?
        .as_array()?
        .iter()
        .find(|option| option["category"] == "model" || option["configId"] == "model")?
        .get("currentValue")?
        .as_str()
}
pub(crate) fn observe(app: &AppHandle, agent: &str, session: &str, value: &Value, admitted_generation: Option<u64>) {
    let Some(model) = selected_model(value) else { return };
    let state = app.state::<Providers>();
    let mut gate = state.managed.gate.lock().unwrap();
    if model.starts_with(MODEL_PREFIX) {
        let generation = admitted_generation.unwrap_or(gate.generation);
        if admitted_generation.is_some() || !gate.routes.contains_key(session) {
            gate.routes.insert(session.into(), Route { agent: agent.into(), generation, model: model.into() });
            if gate.account.is_none() || generation != gate.generation || !gate.models.contains(model) {
                let _ = RevokedSessions { session_ids: vec![session.into()] }.emit(app);
            }
        }
    } else if admitted_generation == Some(gate.generation) {
        gate.routes.remove(session);
    }
}

pub(crate) fn observe_event(app: &AppHandle, event: &alwith_api::RuntimeEvent) {
    match event {
        alwith_api::RuntimeEvent::AcpNotification { method, params, .. }
            if method == "_codex/realtime/update" && params["event"] == "closed" =>
        {
            if let Some(session) = params["sessionId"].as_str() {
                app.state::<Providers>().managed.gate.lock().unwrap().realtime.remove(session);
            }
        }
        alwith_api::RuntimeEvent::AcpNotification { agent_id, method, params, .. } if method == "session/update" => {
            if let Some(session) = params["sessionId"].as_str() {
                observe(app, agent_id, session, &params["update"], None);
            }
        }
        alwith_api::RuntimeEvent::Inbound { agent_id, lines } => {
            for line in lines {
                if let Ok(frame) = serde_json::from_str::<Value>(line)
                    && frame["method"] == "session/update"
                    && let Some(session) = frame["params"]["sessionId"].as_str()
                {
                    observe(app, agent_id, session, &frame["params"]["update"], None);
                }
            }
        }
        alwith_api::RuntimeEvent::Exit { agent_id } => {
            let state = app.state::<Providers>();
            let mut gate = state.managed.gate.lock().unwrap();
            gate.targets.remove(agent_id);
            gate.realtime.retain(|_, agent| agent != agent_id);
            // Keep revoked selections across adapter restarts until explicit reselection.
        }
        _ => {}
    }
}

/// All webview request shapes pass here, including drafts and raw ACP configuration changes.
pub(crate) fn check(app: &AppHandle, method: &str, params: Option<&Value>) -> Result<u64, String> {
    let state = app.state::<Providers>();
    let gate = state.managed.gate.lock().unwrap();
    if method == "send" {
        return Err("Use structured Runtime requests for session operations".into());
    }
    let Some(params) = params else { return Ok(gate.generation) };
    let (method, body) = if matches!(method, "acpRequest" | "acpNotify") {
        (params["method"].as_str().unwrap_or(""), &params["params"])
    } else {
        (method, params)
    };
    check_request(&gate, method, body)?;
    Ok(gate.generation)
}

pub(crate) fn requires_admission(method: &str, params: Option<&Value>) -> bool {
    let Some(params) = params else { return false };
    matches!(method, "acpRequest" | "acpNotify")
        && matches!(
            params["method"].as_str(),
            Some(
                "_session/steering"
                    | "_session/goal"
                    | "_codex/session/goal_control"
                    | "_codex/session_retry"
                    | "_codex/session_prediction_request"
                    | "_codex/realtime/start"
                    | "_codex/realtime/appendAudio"
                    | "_codex/realtime/appendText"
                    | "_codex/realtime/appendSpeech"
            )
        )
}

pub(crate) fn observe_realtime(app: &AppHandle, method: &str, params: &Value) {
    if method != "acpRequest" {
        return;
    }
    let Some(session) = params["params"]["sessionId"].as_str() else {
        return;
    };
    let state = app.state::<Providers>();
    let mut gate = state.managed.gate.lock().unwrap();
    match params["method"].as_str() {
        Some("_codex/realtime/start") => {
            if let Some(route) = gate.routes.get(session) {
                let agent = route.agent.clone();
                gate.realtime.insert(session.into(), agent);
            }
        }
        Some("_codex/realtime/stop") => {
            gate.realtime.remove(session);
        }
        _ => {}
    }
}

pub(crate) fn confirms_model(method: &str, params: &Value) -> bool {
    let (method, body) = if matches!(method, "acpRequest" | "acpNotify") {
        (params["method"].as_str().unwrap_or(""), &params["params"])
    } else {
        (method, params)
    };
    matches!(
        method,
        "sessionNew"
            | "session/new"
            | "sessionResume"
            | "session/resume"
            | "sessionLoad"
            | "session/load"
            | "sessionFork"
            | "session/fork"
    ) || (method == "session/set_config_option" && body["configId"] == "model")
}

fn check_request(gate: &Gate, method: &str, body: &Value) -> Result<(), String> {
    let selection = method == "session/set_config_option" && body["configId"] == "model";
    let lifecycle = matches!(
        method,
        "sessionNew"
            | "session/new"
            | "sessionResume"
            | "session/resume"
            | "sessionLoad"
            | "session/load"
            | "sessionFork"
            | "session/fork"
    );
    let execution = matches!(
        method,
        "prompt"
            | "session/prompt"
            | "_session/steering"
            | "_session/goal"
            | "_codex/session/goal_control"
            | "_codex/session_retry"
            | "_codex/session_prediction_request"
            | "_codex/realtime/start"
            | "_codex/realtime/appendAudio"
            | "_codex/realtime/appendText"
            | "_codex/realtime/appendSpeech"
    );
    if !(method == "session/set_config_option" || lifecycle || execution) {
        return Ok(());
    }
    let explicit_resume = matches!(method, "sessionResume" | "session/resume")
        && (body
            .pointer("/_meta/alwith/accountModelSelection")
            .or_else(|| body.pointer("/meta/alwith/accountModelSelection"))
            == Some(&Value::Bool(true)));
    let requested = if selection {
        body["value"].as_str()
    } else if lifecycle {
        body.pointer("/_meta/alwith/model").or_else(|| body.pointer("/meta/alwith/model")).and_then(Value::as_str)
    } else {
        None
    };
    // Prompt metadata is not a model selection. Only the adapter's explicit model option
    // can authorize an old session under a new account.
    if explicit_resume && requested.is_none() {
        return Err("Explicit model recovery requires a model".into());
    }
    gate.check_selection(requested, if selection || explicit_resume { None } else { body["sessionId"].as_str() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revoked_route_cannot_send_under_a_replacement_account() {
        let mut gate = Gate {
            account: Some(Account { api_base_url: "https://api.alwith.ai/service".into(), user_uuid: "a".into() }),
            generation: 1,
            ..Gate::default()
        };
        gate.models.insert("gateway:litellm:m".into());
        gate.routes.insert(
            "session".into(),
            Route { agent: "codex".into(), generation: 1, model: "gateway:litellm:m".into() },
        );
        assert!(gate.check_selection(None, Some("session")).is_ok());
        gate.invalidate().unwrap();
        assert!(gate.check_selection(Some("gateway:litellm:m"), None).is_err());
        gate.account = Some(Account { api_base_url: "https://api.alwith.ai/service".into(), user_uuid: "b".into() });
        gate.models.insert("gateway:litellm:m".into());
        assert!(gate.check_selection(None, Some("session")).is_err());
        assert!(gate.check_selection(Some("gpt-native"), Some("session")).is_err());
        // Only an explicit model selection validates the new model without inheriting the old route.
        assert!(gate.check_selection(Some("gpt-native"), None).is_ok());
    }

    #[test]
    fn automatic_model_hints_do_not_authorize_a_replacement_account() {
        let mut gate = Gate {
            account: Some(Account { api_base_url: "https://api.alwith.ai/service".into(), user_uuid: "b".into() }),
            generation: 2,
            ..Gate::default()
        };
        let model = "gateway:litellm:m";
        gate.models.insert(model.into());
        gate.routes.insert("old".into(), Route { agent: "codex".into(), generation: 1, model: model.into() });
        assert!(gate.check_selection(Some(model), Some("old")).is_err());
    }

    #[test]
    fn execution_hints_cannot_bypass_revocation_and_explicit_selection_can_recover() {
        let mut gate = Gate::default();
        gate.routes
            .insert("old".into(), Route { agent: "codex".into(), generation: 0, model: "gateway:litellm:m".into() });
        let body = json!({"sessionId":"old", "_meta":{"alwith":{"model":"gpt-native"}}});
        for method in [
            "prompt",
            "session/prompt",
            "_session/steering",
            "_session/goal",
            "_codex/session/goal_control",
            "_codex/session_retry",
            "_codex/session_prediction_request",
            "_codex/realtime/start",
            "_codex/realtime/appendAudio",
            "_codex/realtime/appendText",
            "_codex/realtime/appendSpeech",
            "sessionResume",
            "session/resume",
            "sessionFork",
            "session/fork",
        ] {
            assert!(check_request(&gate, method, &body).is_err(), "{method}");
        }
        assert!(
            check_request(
                &gate,
                "session/set_config_option",
                &json!({"sessionId":"old", "configId":"model", "value":"gpt-native"})
            )
            .is_ok()
        );
        assert!(
            check_request(
                &gate,
                "session/set_config_option",
                &json!({"sessionId":"old", "configId":"model", "value":"gateway:litellm:m"})
            )
            .is_err()
        );
    }

    #[test]
    fn explicit_resume_authorizes_only_a_valid_model_and_never_authorizes_prompt_metadata() {
        let mut gate = Gate::default();
        gate.routes
            .insert("old".into(), Route { agent: "codex".into(), generation: 0, model: "gateway:litellm:m".into() });
        let body = json!({"sessionId":"old", "_meta":{"alwith":{"model":"gpt-native", "accountModelSelection":true}}});
        assert!(check_request(&gate, "session/resume", &body).is_ok());
        assert!(check_request(&gate, "session/prompt", &body).is_err());
        assert!(
            check_request(
                &gate,
                "session/resume",
                &json!({"sessionId":"old", "_meta":{"alwith":{"accountModelSelection":true}}})
            )
            .is_err()
        );
        assert!(check_request(&gate, "session/resume", &json!({"sessionId":"old", "_meta":{"alwith":{"accountModelSelection":true,"model":"gateway:litellm:m"}}})).is_err());
    }

    #[test]
    fn changing_effort_is_not_an_account_model_selection() {
        let mut gate = Gate::default();
        gate.routes
            .insert("old".into(), Route { agent: "codex".into(), generation: 0, model: "gateway:litellm:m".into() });
        let body = json!({"sessionId":"old", "configId":"reasoning_effort", "value":"high"});
        assert!(check_request(&gate, "session/set_config_option", &body).is_err());
        assert!(!confirms_model("acpRequest", &json!({"method":"session/set_config_option", "params":body})));
        assert!(confirms_model(
            "acpRequest",
            &json!({"method":"session/set_config_option", "params":{"configId":"model"}})
        ));
    }

    #[test]
    fn responses_endpoint_accepts_root_or_versioned_base_without_guessing_other_paths() {
        assert_eq!(responses_base_url("http://localhost:8080").unwrap(), "http://localhost:8080/v1");
        assert_eq!(responses_base_url("http://gateway.internal:8080").unwrap(), "http://gateway.internal:8080/v1");
        for invalid in ["file:///v1", "https://key@gateway.test/v1", "https://gateway.test/v1?key=secret"] {
            assert!(responses_base_url(invalid).is_err());
        }
        assert_eq!(responses_base_url("https://gateway.test/v1/").unwrap(), "https://gateway.test/v1");
        assert_eq!(responses_base_url("https://gateway.test/proxy/v1").unwrap(), "https://gateway.test/proxy/v1");
        assert!(responses_base_url("https://gateway.test/proxy").is_err());
    }

    #[test]
    fn removing_a_model_blocks_new_requests_on_its_existing_route() {
        let mut gate = Gate {
            account: Some(Account { api_base_url: "https://api.alwith.ai/service".into(), user_uuid: "a".into() }),
            ..Gate::default()
        };
        gate.routes.insert(
            "session".into(),
            Route { agent: "codex".into(), generation: 0, model: "gateway:litellm:removed".into() },
        );
        assert!(gate.check_selection(None, Some("session")).is_err());
        assert!(gate.check_selection(Some("gateway:litellm:removed"), None).is_err());
    }
}
