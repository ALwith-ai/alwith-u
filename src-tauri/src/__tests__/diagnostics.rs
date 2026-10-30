use super::*;

#[test]
fn proxy_errors_preserve_transport_evidence_without_raw_content() {
    let message = format!(
        "unexpected status 502 Bad Gateway: Responses compatibility proxy could not forward the request (ECONNRESET), url: http://127.0.0.1:59724/{}/responses Authorization: Bearer sk-private-message",
        "a".repeat(48),
    );
    let error = signature(&message);
    assert_eq!(error.kind, "model_proxy_transport");
    assert_eq!(error.transport_code.as_deref(), Some("ECONNRESET"));
    assert_eq!(error.http_status, Some(502));
    assert_eq!(error.loopback_port, Some(59724));
    let exported = serde_json::to_string(&error).unwrap();
    assert!(!exported.contains("sk-private"));
    assert!(!exported.contains(&"a".repeat(48)));
    assert!(!exported.contains("http://"));
}

#[test]
fn request_projection_excludes_prompts_credentials_paths_and_model_names() {
    let params = json!({"method":"session/set_config_option","agentId":"codex","params":{
        "sessionId":"private-session-id","configId":"model","value":"gateway:litellm:private-model",
        "cwd":"C:\\Users\\Alice\\secret-project","prompt":[{"type":"text","text":"private conversation"}],
        "_meta":{"codex":{"bearerToken":"private-token"}}
    }});
    let trace = RequestTrace::begin("acpRequest", Some(&params), "window-secret:42");
    let context = trace.context.as_ref().unwrap();
    assert_eq!(context.operation.as_deref(), Some("session/set_config_option"));
    assert_eq!(context.session_ref, Some(reference("private-session-id")));
    assert_eq!(context.provider.as_deref(), Some("litellm"));
    let output = serde_json::to_string(context).unwrap();
    for secret in
        ["private-session-id", "private-model", "private-token", "Alice", "private conversation", "window-secret"]
    {
        assert!(!output.contains(secret), "leaked {secret}");
    }
    assert!(RequestTrace::begin("sessionEvents", Some(&params), "42").context.is_none());
}

#[test]
fn changing_models_and_missing_sessions_remain_correlatable() {
    let params = |model| json!({"sessionId":"same-session","configId":"model","value":model});
    let a = RequestTrace::begin(
        "acpRequest",
        Some(&json!({"method":"session/set_config_option","params":params("gateway:deepseek:flash")})),
        "1",
    );
    let b = RequestTrace::begin(
        "acpRequest",
        Some(&json!({"method":"session/set_config_option","params":params("gpt-6-sol")})),
        "2",
    );
    assert_eq!(a.context.as_ref().unwrap().session_ref, b.context.as_ref().unwrap().session_ref);
    assert_ne!(a.context.as_ref().unwrap().model_ref, b.context.as_ref().unwrap().model_ref);
    assert_eq!(signature("Session same-session not found").kind, "session_not_found");
}

#[test]
fn generic_rpc_failures_keep_the_classification_of_nested_agent_details() {
    for data in [
        json!("Session private-session not found"),
        json!({"details":"Session private-session not found","apiKey":"private-key"}),
    ] {
        let error = rpc_signature("Internal error", Some(&data));
        assert_eq!(error.kind, "session_not_found");
        let output = serde_json::to_string(&error).unwrap();
        assert!(!output.contains("private-session"));
        assert!(!output.contains("private-key"));
    }
}

#[test]
fn reports_survive_restarts_and_do_not_duplicate_the_memory_tail() {
    let directory = tempfile::tempdir().unwrap();
    let first = Collector::new(directory.path().into());
    first.record("app", "started", Context::default());
    assert_eq!(first.report().unwrap()["events"].as_array().unwrap().len(), 1);
    let second = Collector::new(directory.path().into());
    second.record("app", "started", Context::default());
    let report = second.report().unwrap();
    let events = report["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_ne!(events[0]["launchId"], events[1]["launchId"]);
}

#[test]
fn disk_rotation_is_bounded_and_corrupt_records_are_not_exported() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    for _ in 0..FILE_COUNT + 2 {
        fs::write(collector.file(0), vec![b'x'; FILE_BYTES as usize]).unwrap();
        collector.record("app", "started", Context::default());
    }
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), FILE_COUNT);
    for file in fs::read_dir(directory.path()).unwrap() {
        assert!(file.unwrap().metadata().unwrap().len() <= FILE_BYTES);
    }
    let report = collector.report().unwrap();
    assert!(report["recording"]["discardedRecords"].as_u64().unwrap() > 0);
    assert!(report["events"].as_array().unwrap().iter().all(|event| event["phase"] == "started"));
}

#[test]
fn disk_failure_keeps_a_bounded_memory_report_and_can_recover() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("unavailable");
    fs::write(&path, b"not a directory").unwrap();
    let collector = Collector::new(path.clone());
    for _ in 0..MEMORY_EVENTS + 4 {
        collector.record("app", "started", Context::default());
    }
    let report = collector.report().unwrap();
    assert_eq!(report["recording"]["writeFailed"], true);
    assert_eq!(report["events"].as_array().unwrap().len(), MEMORY_EVENTS);
    fs::remove_file(&path).unwrap();
    collector.record("app", "recovered", Context::default());
    assert!(collector.file(0).exists());
}

#[test]
fn repeated_runtime_states_do_not_displace_diagnostic_history() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    for _ in 0..10 {
        collector.state("one-session", "running");
    }
    collector.state("one-session", "done");
    let report = collector.report().unwrap();
    let events = report["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["context"]["sessionRef"], events[1]["context"]["sessionRef"]);
    assert_eq!(events[1]["context"]["state"], "done");
}

#[test]
fn exporting_atomically_replaces_a_report_and_cleans_up_temporary_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("report.json");
    fs::write(&path, b"old report").unwrap();
    write_report(&path, &json!({"schema":"test","events":[]})).unwrap();
    let report: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(report["schema"], "test");
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    assert!(write_report(&directory.path().join("missing/report.json"), &report).is_err());
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

fn fixture_event(at: i64, sequence: u64) -> Event {
    Event {
        timestamp_ms: at,
        launch_id: uuid::Uuid::new_v4().to_string(),
        sequence,
        source: "app".into(),
        phase: "started".into(),
        context: Context::default(),
    }
}

#[test]
fn cleanup_removes_expired_records_from_mixed_files_and_memory() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    let at = now();
    let expired = fixture_event(at - RETENTION_MS - 1, 1);
    let boundary = fixture_event(at - RETENTION_MS, 2);
    let fresh = fixture_event(at, 3);
    for event in [&expired, &boundary, &fresh] {
        collector.append(event).unwrap();
    }
    let mut inner = collector.inner.lock().unwrap();
    inner.memory.push_back(expired);
    collector.cleanup(at, &mut inner);
    assert!(inner.memory.is_empty());
    assert!(!inner.cleanup_failed);
    assert_eq!(inner.discarded_records, 1);
    drop(inner);
    let bytes = collector.read(0).unwrap();
    let kept: Vec<Event> = bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_slice(line).unwrap())
        .collect();
    assert_eq!(kept.len(), 2);
    assert_eq!(kept[0].sequence, 2);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn startup_and_export_clear_old_records_and_abandoned_cleanup_files() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    collector.append(&fixture_event(now() - RETENTION_MS - 1000, 1)).unwrap();
    fs::write(directory.path().join("events-0.cleanup"), b"interrupted cleanup").unwrap();
    collector.record("app", "started", Context::default());
    let report = collector.report().unwrap();
    assert_eq!(report["recording"]["retentionDays"], 7);
    assert_eq!(report["events"].as_array().unwrap().len(), 1);
    assert!(!directory.path().join("events-0.cleanup").exists());
    assert!(!collector.read(0).unwrap().windows(19).any(|bytes| bytes == b"interrupted cleanup"));
}

#[test]
fn future_timestamps_and_untrusted_field_values_never_enter_an_export() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    collector.append(&fixture_event(now() + FUTURE_TOLERANCE_MS + 60_000, 1)).unwrap();
    let mut modified = fixture_event(now(), 2);
    modified.context.session_ref = Some("Bearer private-key".into());
    collector.append(&modified).unwrap();
    let report = collector.report().unwrap();
    assert!(report["events"].as_array().unwrap().is_empty());
    assert!(!report.to_string().contains("private-key"));
    assert_eq!(report["recording"]["discardedRecords"], 2);
    assert!(!collector.file(0).exists());
}

#[test]
fn a_partial_last_line_does_not_swallow_the_next_event() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    fs::write(collector.file(0), b"{\"timestampMs\":").unwrap();
    collector.append(&fixture_event(now(), 2)).unwrap();
    let report = collector.report().unwrap();
    assert_eq!(report["events"].as_array().unwrap().len(), 1);
    assert_eq!(report["events"][0]["sequence"], 2);
    assert_eq!(report["recording"]["discardedRecords"], 1);
}

#[test]
fn maintenance_runs_without_another_event_and_reports_cleanup_failure() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    collector.append(&fixture_event(now() - RETENTION_MS - 1000, 1)).unwrap();
    collector.maintain();
    assert!(!collector.file(0).exists());
    fs::create_dir(collector.file(0)).unwrap();
    let report = collector.report().unwrap();
    assert_eq!(report["recording"]["cleanupFailed"], true);
    assert!(report["recording"]["incompleteRecords"].as_u64().unwrap() > 0);
}

#[test]
fn concurrent_recording_and_exports_preserve_complete_unique_events() {
    let directory = tempfile::tempdir().unwrap();
    let collector = std::sync::Arc::new(Collector::new(directory.path().into()));
    std::thread::scope(|scope| {
        for _ in 0..4 {
            let collector = collector.clone();
            scope.spawn(move || {
                for _ in 0..40 {
                    collector.record("app", "started", Context::default());
                }
            });
        }
        let collector = collector.clone();
        scope.spawn(move || {
            for _ in 0..10 {
                assert!(collector.report().is_ok());
            }
        });
    });
    let report = collector.report().unwrap();
    let events = report["events"].as_array().unwrap();
    assert_eq!(events.len(), 160);
    let ids = events.iter().map(|event| event["sequence"].as_u64().unwrap()).collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), 160);
    assert_eq!(report["recording"]["cleanupFailed"], false);
}

#[test]
fn clock_changes_do_not_reorder_requests_within_a_launch() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    let first = fixture_event(now(), 1);
    let mut second = fixture_event(now() - 1000, 2);
    second.launch_id = first.launch_id.clone();
    collector.append(&first).unwrap();
    collector.append(&second).unwrap();
    let report = collector.report().unwrap();
    assert_eq!(report["events"][0]["sequence"], 1);
    assert_eq!(report["events"][1]["sequence"], 2);
}

fn proxy_line() -> String {
    format!(
        "[alwith-model-proxy] {}",
        json!({
            "version":1,"requestId":"0123456789abcdef01234567","transport":"http","destination":"external",
            "runtime":"bun-fetch","stage":"connect_upstream","phase":"failed","targetHost":"api.deepseek.com",
            "targetPort":443,"endpoint":"responses","status":null,"upstreamRequestId":null,"sentBytes":123,
            "receivedBytes":0,"firstByteMs":null,"reusedSocket":null,"proxyEnv":["HTTPS_PROXY"],"noProxySet":true,
            "elapsedMs":42,"errors":["ECONNRESET"]
        })
    )
}

#[test]
fn model_proxy_events_survive_bounded_export_with_transport_evidence() {
    let context = model_proxy_context(&proxy_line()).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    collector.record("agent_stderr", "failed", context);
    let report = collector.report().unwrap();
    let event = &report["events"][0];
    assert_eq!(event["context"]["proxy"]["stage"], "connect_upstream");
    assert_eq!(event["context"]["proxy"]["errors"][0], "ECONNRESET");
    assert_eq!(event["context"]["proxy"]["targetHost"], "api.deepseek.com");
    assert_eq!(event["context"]["requestRef"], "0123456789abcdef01234567");
}

#[test]
fn model_proxy_projection_rejects_unknown_fields_and_unbounded_or_private_values() {
    let original: Value = serde_json::from_str(proxy_line().strip_prefix("[alwith-model-proxy] ").unwrap()).unwrap();
    for (field, value) in [
        ("authorization", json!("Bearer private-key")),
        ("targetHost", json!("api.example.test/private-path")),
        ("targetHost", json!("user:password@api.example.test")),
        ("requestId", json!("private-session-id")),
        ("errors", json!(["ECONNRESET", "private-message"])),
        ("proxyEnv", json!(["https://user:password@proxy.example.test"])),
    ] {
        let mut invalid = original.clone();
        invalid[field] = value;
        assert!(model_proxy_context(&format!("[alwith-model-proxy] {invalid}")).is_none(), "accepted {field}");
    }
    assert!(model_proxy_context(&format!("[alwith-model-proxy] {}", "x".repeat(8193))).is_none());
}
