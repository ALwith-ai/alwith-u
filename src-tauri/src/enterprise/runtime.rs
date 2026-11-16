//! Enterprise admission remains a U policy around the unchanged shared chat and Runtime.
use super::*;
use alwith_api::{RunState, RuntimeEvent};

pub(crate) fn check(app: &AppHandle, method: &str, params: Option<&Value>) -> Result<u64, String> {
    let state = app.state::<Enterprise>();
    let gate = state.gate.lock().unwrap();
    match params {
        Some(params) => gate.check_request(method, params),
        None => Ok(gate.generation),
    }
}

pub(crate) fn observe(app: &AppHandle, agent: &str, session: &str, value: &Value, generation: Option<u64>) {
    let Some(model) = value["configOptions"]
        .as_array()
        .and_then(|options| {
            options.iter().find(|option| option["category"] == "model" || option["configId"] == "model")
        })
        .and_then(|option| option["currentValue"].as_str())
    else {
        return;
    };
    let state = app.state::<Enterprise>();
    state.gate.lock().unwrap().observe(session, agent, model, generation);
    if let Err(reason) = state.changed(app) {
        log::error!("Enterprise session notification failed: {reason}");
    }
}

pub(crate) fn observe_event(app: &AppHandle, event: &RuntimeEvent) {
    match event {
        RuntimeEvent::AcpNotification { agent_id, method, params, .. } if method == "session/update" => {
            if let Some(session) = params["sessionId"].as_str() {
                observe(app, agent_id, session, &params["update"], None);
            }
        }
        RuntimeEvent::Inbound { agent_id, lines } => {
            for line in lines {
                if let Ok(frame) = serde_json::from_str::<Value>(line)
                    && frame["method"] == "session/update"
                    && let Some(session) = frame["params"]["sessionId"].as_str()
                {
                    observe(app, agent_id, session, &frame["params"]["update"], None);
                }
            }
        }
        RuntimeEvent::AcpNotification { method, params, .. }
            if method == "_codex/realtime/update" && params["event"] == "closed" =>
        {
            if let Some(session) = params["sessionId"].as_str() {
                app.state::<Enterprise>().realtime.lock().unwrap().remove(session);
            }
        }
        RuntimeEvent::Exit { agent_id } => {
            let state = app.state::<Enterprise>();
            state.ready_agents.lock().unwrap().remove(agent_id);
            state.applied.lock().unwrap().remove(agent_id);
            state.configured.lock().unwrap().remove(agent_id);
            let gate = state.gate.lock().unwrap();
            state
                .realtime
                .lock()
                .unwrap()
                .retain(|session| gate.routes.get(session).is_some_and(|route| &route.agent != agent_id));
        }
        _ => {}
    }
}

pub(crate) fn observe_realtime(app: &AppHandle, method: &str, params: &Value) {
    if method != "acpRequest" {
        return;
    }
    let Some(session) = params["params"]["sessionId"].as_str() else { return };
    let state = app.state::<Enterprise>();
    match params["method"].as_str() {
        Some("_codex/realtime/start") if state.gate.lock().unwrap().routes.contains_key(session) => {
            state.realtime.lock().unwrap().insert(session.into());
        }
        Some("_codex/realtime/stop") => {
            state.realtime.lock().unwrap().remove(session);
        }
        _ => {}
    }
}

pub(super) async fn cleanup(app: &AppHandle) -> Result<(), Value> {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    let state = app.state::<Enterprise>();
    let routes = {
        let gate = state.gate.lock().unwrap();
        gate.revoked().into_iter().map(|id| (id.clone(), gate.routes[&id].clone())).collect::<Vec<_>>()
    };
    let current = {
        let gate = state.gate.lock().unwrap();
        state
            .connection
            .lock()
            .unwrap()
            .as_ref()
            .filter(|_| gate.account.is_some() && !gate.models.is_empty())
            .map(codex::Connection::runtime_id)
    };
    let obsolete = state
        .configured
        .lock()
        .unwrap()
        .iter()
        .flat_map(|(agent, ids)| {
            ids.iter()
                .filter(|id| Some(id.as_str()) != current.as_deref())
                .map(|id| (agent.clone(), id.clone()))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if routes.is_empty() && obsolete.is_empty() {
        return Ok(());
    }
    let client = runtime.current().map_err(error)?;
    let active: BTreeSet<_> = client
        .run_states()
        .await
        .map_err(|_| error("Enterprise run state unavailable"))?
        .into_iter()
        .filter(|session| matches!(session.state, RunState::Running | RunState::RequiresAction))
        .map(|session| session.session_id)
        .collect();
    for (session, route) in &routes {
        let realtime = state.realtime.lock().unwrap().contains(session);
        if realtime {
            client
                .acp_request(&route.agent, "_codex/realtime/stop", json!({"sessionId":session}), None, None)
                .await
                .map_err(|_| error("Enterprise realtime cleanup failed"))?;
            state.realtime.lock().unwrap().remove(session);
        }
        if active.contains(session) {
            client.cancel(&route.agent, session, None).await.map_err(|_| error("Enterprise session cleanup failed"))?;
        }
    }
    if !routes.is_empty() {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let active =
                    client.run_states().await.map_err(|_| error("Enterprise cancellation state unavailable"))?;
                if !active.iter().any(|session| {
                    routes.iter().any(|(id, _)| id == &session.session_id)
                        && matches!(session.state, RunState::Running | RunState::RequiresAction)
                }) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Ok::<(), Value>(())
        })
        .await
        .map_err(|_| error("Enterprise turn cancellation timed out"))??;
    }
    for (agent, id) in obsolete {
        let guard = tokio::time::timeout(std::time::Duration::from_secs(10), state.configuration.clone().lock_owned())
            .await
            .map_err(|_| error("Enterprise provider update is still settling"))?;
        let app = app.clone();
        let client = client.clone();
        let mut mutation = tauri::async_runtime::spawn(async move {
            let _configuration = guard;
            let live = client.agents().await.map_err(|_| error("Enterprise agent list unavailable"))?;
            if live.iter().any(|item| item["agentId"] == agent) {
                client
                    .acp_request(
                        &agent,
                        "providers/disable",
                        json!({"providerId":"openai","_meta":{"codex":{"id":id}}}),
                        None,
                        None,
                    )
                    .await
                    .map_err(|_| error("Enterprise provider removal failed"))?;
            }
            let state = app.state::<Enterprise>();
            if app.state::<crate::runtime::RuntimeState>().current().is_ok_and(|current| Arc::ptr_eq(&current, &client))
            {
                if let Some(ids) = state.configured.lock().unwrap().get_mut(&agent) {
                    ids.remove(&id);
                }
                state.applied.lock().unwrap().remove(&agent);
            }
            Ok::<(), Value>(())
        });
        tokio::time::timeout(std::time::Duration::from_secs(10), &mut mutation)
            .await
            .map_err(|_| error("Enterprise provider removal is still settling"))?
            .map_err(|_| error("Enterprise provider removal worker failed"))??;
    }
    Ok(())
}

/// Apply only U's enterprise relay. Other provider configuration remains entirely shared-chat owned.
pub(crate) async fn apply(app: &AppHandle, client: &Arc<alwith_api::RuntimeClient>, agent: &str) -> Result<(), String> {
    let state = app.state::<Enterprise>();
    let (generation, params) = {
        let gate = state.gate.lock().unwrap();
        let connection = state.connection.lock().unwrap();
        let Some(connection) = connection.as_ref().filter(|_| gate.account.is_some() && !gate.models.is_empty()) else {
            return Ok(());
        };
        (gate.generation, connection.params.clone())
    };
    if state.applied.lock().unwrap().get(agent) == Some(&params) {
        return Ok(());
    }
    let id = params["_meta"]["codex"]["id"].as_str().expect("enterprise runtime provider ID").to_string();
    let guard = tokio::time::timeout(std::time::Duration::from_secs(10), state.configuration.clone().lock_owned())
        .await
        .map_err(|_| "Enterprise provider update is still settling")?;
    let app = app.clone();
    let client = client.clone();
    let agent = agent.to_string();
    // A timeout must not cancel a mutation already sent to the adapter. Its task retains the
    // enterprise configuration lock until its response (and any stale-route removal) settles.
    let mut mutation = tauri::async_runtime::spawn(async move {
        let _configuration = guard;
        let state = app.state::<Enterprise>();
        if state.gate.lock().unwrap().generation != generation {
            return Err("ALwith account changed".into());
        }
        state.configured.lock().unwrap().entry(agent.clone()).or_default().insert(id.clone());
        client
            .acp_request(&agent, "providers/set", params.clone(), None, None)
            .await
            .map_err(|_| "Enterprise provider configuration failed".to_string())?;
        let same_runtime =
            app.state::<crate::runtime::RuntimeState>().current().is_ok_and(|current| Arc::ptr_eq(&current, &client));
        if !same_runtime {
            return Err("Runtime changed during enterprise configuration".into());
        }
        let current = state.gate.lock().unwrap().generation == generation
            && state.connection.lock().unwrap().as_ref().is_some_and(|connection| connection.params == params);
        if !current {
            if client
                .acp_request(
                    &agent,
                    "providers/disable",
                    json!({"providerId":"openai","_meta":{"codex":{"id":id}}}),
                    None,
                    None,
                )
                .await
                .is_ok()
            {
                if let Some(ids) = state.configured.lock().unwrap().get_mut(&agent) {
                    ids.remove(&id);
                }
                state.applied.lock().unwrap().remove(&agent);
            }
            return Err("ALwith account changed during enterprise configuration".into());
        }
        state.applied.lock().unwrap().insert(agent, params);
        Ok(())
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), &mut mutation)
        .await
        .map_err(|_| "Enterprise provider configuration timed out".to_string())?
        .map_err(|_| "Enterprise provider worker failed".to_string())?
}

pub(crate) fn ready(app: &AppHandle, agent: &str) {
    let state = app.state::<Enterprise>();
    state.ready_agents.lock().unwrap().insert(agent.into());
    state.applied.lock().unwrap().remove(agent);
}
pub(crate) fn reset(app: &AppHandle) {
    let state = app.state::<Enterprise>();
    state.ready_agents.lock().unwrap().clear();
    state.applied.lock().unwrap().clear();
    state.configured.lock().unwrap().clear();
    state.realtime.lock().unwrap().clear();
}
pub(super) async fn apply_ready(app: &AppHandle) {
    let runtime = app.state::<crate::runtime::RuntimeState>();
    let _admission = runtime.admission.lock().await;
    let Ok(client) = runtime.current() else { return };
    let agents = app.state::<Enterprise>().ready_agents.lock().unwrap().iter().cloned().collect::<Vec<_>>();
    for agent in agents {
        if let Err(reason) = apply(app, &client, &agent).await {
            // Busy enterprise routes retain their running configuration; the next admission retries.
            log::warn!("Enterprise route update deferred for {agent}: {reason}");
        }
    }
}

pub(crate) fn uses_enterprise(app: &AppHandle, method: &str, params: Option<&Value>) -> bool {
    params.is_some_and(|params| app.state::<Enterprise>().gate.lock().unwrap().uses(method, params))
}
