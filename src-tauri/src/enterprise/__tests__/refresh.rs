use super::*;

const PROVIDER: &str = "custom_alwith_enterprise_test";

fn connection(model: &str, revision: u64) -> codex::Connection {
    codex::Connection {
        provider: codex::Provider {
            id: PROVIDER.into(),
            name: "Enterprise".into(),
            base_url: "https://gateway.example.test".into(),
            models: vec![codex::PublicModel {
                api_id: model.into(),
                label: model.into(),
                context_window: None,
                description: None,
            }],
        },
        params: json!({"revision":revision}),
        models: BTreeSet::from([codex::model_id(PROVIDER, model)]),
    }
}

fn ready() -> (Enterprise, u64, String) {
    let state = Enterprise::default();
    let generation = state.gate.lock().unwrap().bind("account".into()).unwrap();
    state.commit_refresh(generation, Ok(Some(connection("issued/model", 1)))).unwrap();
    let model = codex::model_id(PROVIDER, "issued/model");
    state.gate.lock().unwrap().observe("session", "codex", &model, Some(generation));
    state.applied.lock().unwrap().insert("codex".into(), json!({"revision":1}));
    (state, generation, model)
}

fn assert_admitted(state: &Enterprise, model: &str) {
    let gate = state.gate.lock().unwrap();
    for method in [
        "prompt",
        "session/prompt",
        "sessionResume",
        "session/resume",
        "sessionLoad",
        "session/load",
        "sessionFork",
        "session/fork",
        "_codex/session_retry",
        "_session/steering",
        "_codex/realtime/start",
    ] {
        gate.check_request(method, &json!({"sessionId":"session"})).expect(method);
    }
    // No invalid route means no managed-revoked notification or cleanup candidate.
    assert!(gate.routes.keys().all(|id| gate.check(None, Some(id)).is_ok()));
    assert!(gate.check(Some(model), None).is_ok());
}

#[test]
fn failed_discovery_preserves_the_relay_and_admission_for_prompt_resume_and_fork() {
    let (state, generation, model) = ready();
    for failure in [
        json!({"kind":"network","message":"enterprise_gateway_unreachable"}),
        json!({"kind":"timeout","message":"Request timed out"}),
        error("Invalid ALwith provider response"),
        error("Enterprise catalog gateway does not match the configured gateway"),
    ] {
        assert_eq!(state.commit_refresh(generation, Err(failure.clone())), Err(failure));
        assert_admitted(&state, &model);
        assert_eq!(state.connection.lock().unwrap().as_ref().unwrap().params, json!({"revision":1}));
        assert_eq!(state.applied.lock().unwrap()["codex"], json!({"revision":1}));
    }
    // Reproduce the diagnostic timeline: failure, successful refresh, then resume/fork.
    state.commit_refresh(generation, Ok(Some(connection("issued/model", 2)))).unwrap();
    assert_admitted(&state, &model);
    assert_eq!(state.connection.lock().unwrap().as_ref().unwrap().params, json!({"revision":2}));
}

#[test]
fn an_initial_discovery_failure_does_not_invent_a_catalog_or_revoke_an_account() {
    let state = Enterprise::default();
    let generation = state.gate.lock().unwrap().bind("account".into()).unwrap();
    assert!(state.commit_refresh(generation, Err(error("Network unavailable"))).is_err());
    assert!(state.connection.lock().unwrap().is_none());
    let gate = state.gate.lock().unwrap();
    assert_eq!(gate.account.as_deref(), Some("account"));
    assert_eq!(gate.generation, generation);
    assert!(gate.models.is_empty());
    assert!(gate.routes.is_empty());
    assert!(gate.check(Some(&codex::model_id(PROVIDER, "issued/model")), None).is_err());
}

#[test]
fn confirmed_authorization_loss_still_revokes_sessions() {
    let (state, generation, model) = ready();
    state.commit_refresh(generation, Ok(None)).unwrap();
    assert!(state.connection.lock().unwrap().is_none());
    assert!(state.gate.lock().unwrap().check(None, Some("session")).is_err());
    state.commit_refresh(generation, Ok(Some(connection("issued/model", 2)))).unwrap();
    let mut gate = state.gate.lock().unwrap();
    assert!(gate.check(None, Some("session")).is_err());
    // A confirmed revocation still requires explicit model selection.
    gate.observe("session", "codex", &model, Some(generation));
    assert!(gate.check(None, Some("session")).is_ok());
}

#[test]
fn a_successful_catalog_removal_still_revokes_only_the_removed_model() {
    let (state, generation, _) = ready();
    let retained = codex::model_id(PROVIDER, "retained/model");
    state.gate.lock().unwrap().observe("retained", "codex", &retained, Some(generation));
    state.commit_refresh(generation, Ok(Some(connection("retained/model", 2)))).unwrap();
    let gate = state.gate.lock().unwrap();
    assert!(gate.check(None, Some("session")).is_err());
    assert!(gate.check(None, Some("retained")).is_ok());
}

#[test]
fn a_late_refresh_cannot_restore_an_account_after_logout() {
    let (state, generation, _) = ready();
    state.gate.lock().unwrap().invalidate().unwrap();
    *state.connection.lock().unwrap() = None;
    assert!(state.commit_refresh(generation, Ok(Some(connection("issued/model", 2)))).is_err());
    assert!(state.connection.lock().unwrap().is_none());
    assert!(state.gate.lock().unwrap().check(None, Some("session")).is_err());
}

#[test]
fn a_late_refresh_cannot_overwrite_another_accounts_connection() {
    let (state, old_generation, _) = ready();
    let generation = state.gate.lock().unwrap().bind("another-account".into()).unwrap();
    state.commit_refresh(generation, Ok(Some(connection("new/model", 2)))).unwrap();
    assert!(state.commit_refresh(old_generation, Ok(Some(connection("issued/model", 3)))).is_err());
    assert_eq!(state.connection.lock().unwrap().as_ref().unwrap().params, json!({"revision":2}));
    let gate = state.gate.lock().unwrap();
    assert!(gate.check(None, Some("session")).is_err());
    assert!(gate.check(Some(&codex::model_id(PROVIDER, "new/model")), None).is_ok());
}
