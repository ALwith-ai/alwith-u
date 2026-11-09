use super::*;
use std::io::Read;
#[test]
fn computer_driver_and_gateway_errors_are_bundled_in_the_same_zip() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().join("diagnostics"));
    let mut report = export_report(&collector, directory.path(), "ALwith U");
    add_computer_logs(&mut report,
        Ok("Driver ready\nCMUX_CUA_SOCKET_AUTH_TOKEN=private-driver-token\nCMUX_CUA_SOCKET_HOST_AUTH_TOKEN=private-host-token\nMCP waiting for initialize response\nTransport ended: MCP process exited: exit code 1\n".into()));
    let path = directory.path().join("computer.zip");
    write_report(&path, &report).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let metadata: Value = serde_json::from_reader(archive.by_name("diagnostics.json").unwrap()).unwrap();
    for (name, evidence) in [("computer.log", "Driver ready"), ("computer.log", "initialize response")] {
        let file =
            metadata["nativeLogs"]["files"].as_array().unwrap().iter().find(|file| file["name"] == name).unwrap();
        let mut content = String::new();
        archive.by_name(file["archivePath"].as_str().unwrap()).unwrap().read_to_string(&mut content).unwrap();
        assert!(content.contains(evidence));
        assert!(!content.contains("private-driver-token"));
        assert!(!content.contains("private-host-token"));
    }
}

#[test]
fn one_zip_contains_metadata_and_separate_redacted_native_logs() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().join("diagnostics"));
    collector.record("app", "started", Context::default());
    fs::write(directory.path().join("ALwith U.log"), "bridge failed ECONNRESET Authorization: Bearer secret-auth\n")
        .unwrap();
    fs::write(directory.path().join("panic.log"), "panicked at native_network.rs:66\n").unwrap();
    fs::write(directory.path().join("ALwith U_2026-11-03_11-48-00.log"), "previous launch\n").unwrap();
    let path = directory.path().join("export.zip");
    write_report(&path, &export_report(&collector, directory.path(), "ALwith U")).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let report: Value = serde_json::from_reader(archive.by_name("diagnostics.json").unwrap()).unwrap();
    assert_eq!(report["events"][0]["source"], "app");
    assert_eq!(report["nativeLogs"]["files"][0]["name"], "ALwith U.log");
    assert!(report["nativeLogs"]["files"][0].get("content").is_none());
    assert_eq!(report["nativeLogs"]["files"][0]["archivePath"], "logs/ALwith U.log");
    for (name, evidence) in [
        ("logs/ALwith U.log", "ECONNRESET"),
        ("logs/panic.log", "native_network.rs:66"),
        ("logs/ALwith U_2026-11-03_11-48-00.log", "previous launch"),
    ] {
        let mut file = archive.by_name(name).unwrap();
        assert_eq!(file.compression(), zip::CompressionMethod::Deflated);
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        assert!(content.contains(evidence));
        assert!(!content.contains("secret-auth"));
    }
    assert_eq!(archive.len(), 4);
}

#[test]
fn drive_state_and_file_open_failures_travel_in_the_same_redacted_zip() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().join("diagnostics"));
    fs::write(directory.path().join("ALwith U.log"),
        "[workspace-file-open] stage=prepare path=/Users/alice/Drive/report.md Start Drive before opening its files\n[drive-request] operation=start phase=failed ownership conflict\n").unwrap();
    let mut exported = export_report(&collector, directory.path(), "ALwith U");
    add_drive_state(
        &mut exported,
        json!({
            "configured": true, "running": false, "roots": 0, "files": 0,
            "localRoot": "/Users/alice/Drive", "error": "token=secret-drive-token"
        }),
    );
    let path = directory.path().join("drive.zip");
    write_report(&path, &exported).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let report: Value = serde_json::from_reader(archive.by_name("diagnostics.json").unwrap()).unwrap();
    assert_eq!(report["drive"]["running"], false);
    assert_eq!(report["drive"]["roots"], 0);
    assert!(!report.to_string().contains("secret-drive-token"));
    assert!(!report.to_string().contains("/Users/alice"));
    let mut logs = String::new();
    archive.by_name("logs/ALwith U.log").unwrap().read_to_string(&mut logs).unwrap();
    assert!(logs.contains("stage=prepare"));
    assert!(logs.contains("Start Drive before opening its files"));
    assert!(logs.contains("ownership conflict"));
    assert!(!logs.contains("/Users/alice"));
}

#[test]
fn missing_logs_remain_explicit_in_the_zip_manifest() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().join("diagnostics"));
    let path = directory.path().join("export.zip");
    write_report(&path, &export_report(&collector, directory.path(), "ALwith U")).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    assert_eq!(archive.len(), 1);
    let report: Value = serde_json::from_reader(archive.by_name("diagnostics.json").unwrap()).unwrap();
    for file in report["nativeLogs"]["files"].as_array().unwrap() {
        assert_eq!(file["readErrorKind"], "NotFound");
        assert!(file["archivePath"].is_null());
    }
}

#[test]
fn computer_lifecycle_records_survive_export_without_session_ids_or_error_text() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    for action in [
        alwith_computer::Operation::Start,
        alwith_computer::Operation::Stop,
        alwith_computer::Operation::Reconnect,
        alwith_computer::Operation::Ready,
        alwith_computer::Operation::Bind,
    ] {
        collector.record(
            "computer",
            "failed",
            Context {
                operation: Some(action.name().into()),
                session_ref: Some(reference("private-computer-session")),
                error: Some(signature("Computer connection failed at C:\\Users\\private-path")),
                ..Context::default()
            },
        );
    }
    let report = collector.report();
    assert_eq!(report["events"].as_array().unwrap().len(), 5);
    let exported = report.to_string();
    assert!(!exported.contains("private-computer-session"));
    assert!(!exported.contains("private-path"));
    assert!(!exported.contains("Computer connection failed"));
}

#[test]
fn gateway_rejection_is_distinct_from_a_transport_failure() {
    let message = r#"{"error":{"classification":"terminal_http","message":"upstream request was rejected","type":"upstream_error"},"type":"error"}"#;
    let error = signature(message);
    assert_eq!(error.kind, "upstream_rejected");
    assert_eq!(error.http_status, None);
    assert_eq!(error.transport_code, None);
    let exported = serde_json::to_string(&error).unwrap();
    assert!(!exported.contains("upstream request was rejected"));
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().into());
    collector.record("session", "error", Context { error: Some(error), ..Context::default() });
    assert_eq!(collector.report()["events"][0]["context"]["error"]["kind"], "upstream_rejected");
}

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
    assert_eq!(first.report()["events"].as_array().unwrap().len(), 1);
    let second = Collector::new(directory.path().into());
    second.record("app", "started", Context::default());
    let report = second.report();
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
    let report = collector.report();
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
    let report = collector.report();
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
    let report = collector.report();
    let events = report["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["context"]["sessionRef"], events[1]["context"]["sessionRef"]);
    assert_eq!(events[1]["context"]["state"], "done");
}

#[test]
fn exporting_atomically_replaces_a_report_and_cleans_up_temporary_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("report.zip");
    fs::write(&path, b"old report").unwrap();
    let exported = ExportReport {
        metadata: json!({"schema":"test","events":[]}),
        logs: native_logs::collect(directory.path(), "ALwith U"),
    };
    write_report(&path, &exported).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    let report: Value = serde_json::from_reader(archive.by_name("diagnostics.json").unwrap()).unwrap();
    assert_eq!(report["schema"], "test");
    drop(archive);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    assert!(write_report(&directory.path().join("missing/report.zip"), &exported).is_err());
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
    let report = collector.report();
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
    let report = collector.report();
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
    let report = collector.report();
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
    let report = collector.report();
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
                collector.report();
            }
        });
    });
    let report = collector.report();
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
    let report = collector.report();
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
    let report = collector.report();
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

fn native_network_line() -> String {
    format!(
        "[alwith-native-network] {}",
        json!({
            "version":1,"requestId":"0123456789abcdef01234567","transport":"websocket","tlsBackend":"schannel",
            "targetHost":"chatgpt.com","targetPort":443,"phase":"failed","stage":"connect_upstream",
            "route":"proxy","proxyHost":"127.0.0.1","proxyPort":7890,"proxyScheme":"http","proxySource":"windows-pac","winhttpError":12166,
            "elapsedMs":321,"proxyResolveMs":5,"firstByteMs":null,"status":null,"closeCode":null,
            "sentBytes":42,"receivedBytes":0,"errorCode":"NATIVE_NETWORK_CONNECT_FAILED","errorKind":"connect","osError":10054
        })
    )
}
#[test]
fn native_network_metadata_survives_export_and_uses_five_mib_budget() {
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().to_path_buf());
    collector.record("native_network", "failed", native_network_context(&native_network_line()).unwrap());
    let report = collector.report();
    assert_eq!(report["recording"]["maxDiskBytes"], 5 * 1024 * 1024);
    let event = report["events"].as_array().unwrap().iter().find(|e| e["source"] == "native_network").unwrap();
    assert_eq!(event["context"]["requestRef"], "0123456789abcdef01234567");
    assert_eq!(event["context"]["network"]["proxyPort"], 7890);
    assert_eq!(event["context"]["network"]["osError"], 10054);
    assert_eq!(event["context"]["network"]["winhttpError"], 12166);
}
#[test]
fn native_network_projection_rejects_private_and_unbounded_fields() {
    let original: Value =
        serde_json::from_str(native_network_line().strip_prefix("[alwith-native-network] ").unwrap()).unwrap();
    for (field, value) in [
        ("token", json!("secret")),
        ("requestId", json!("secret")),
        ("proxyHost", json!("user:password@proxy")),
        ("targetHost", json!("https://example.com/private")),
        ("errorKind", json!("raw private error")),
        ("errorCode", json!("raw private error")),
    ] {
        let mut invalid = original.clone();
        invalid[field] = value;
        assert!(native_network_context(&format!("[alwith-native-network] {invalid}")).is_none(), "accepted {field}");
    }
}

#[test]
fn native_capacity_rejection_survives_export_with_bounded_counts() {
    let mut value: Value =
        serde_json::from_str(native_network_line().strip_prefix("[alwith-native-network] ").unwrap()).unwrap();
    value["stage"] = json!("admit_request");
    value["errorKind"] = json!("capacity");
    value["errorCode"] = json!("NATIVE_NETWORK_BUSY");
    value["status"] = json!(503);
    value["activeRequests"] = json!(128);
    value["requestLimit"] = json!(128);
    let context = native_network_context(&format!("[alwith-native-network] {value}")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().to_path_buf());
    collector.record("native_network", "failed", context);
    let report = collector.report();
    let network = &report["events"][0]["context"]["network"];
    assert_eq!(network["stage"], "admit_request");
    assert_eq!(network["errorCode"], "NATIVE_NETWORK_BUSY");
    assert_eq!(network["activeRequests"], 128);
    assert_eq!(network["requestLimit"], 128);
    for (active, limit) in [
        (json!(129), json!(128)),
        (json!(1), json!(0)),
        (json!(1), json!(65537)),
        (json!(null), json!(128)),
        (json!(-1), json!(128)),
    ] {
        value["activeRequests"] = active;
        value["requestLimit"] = limit;
        assert!(native_network_context(&format!("[alwith-native-network] {value}")).is_none());
    }
}

#[test]
fn native_network_error_chain_and_proxy_decisions_survive_export_with_redaction() {
    let mut value: Value =
        serde_json::from_str(native_network_line().strip_prefix("[alwith-native-network] ").unwrap()).unwrap();
    value["errorKind"] = json!("tls");
    value["errorChain"] = json!([
        {"message":"TLS handshake failed at https://example.test/private?token=secret", "debug":"Os { code: -2146893019 } api_key=secret"}
    ]);
    value["proxySteps"] = json!([
        {"source":"windows-user", "outcome":"read", "winhttpError":null, "elapsedMs":0},
        {"source":"windows-auto", "outcome":"not_discovered", "winhttpError":12180, "elapsedMs":3},
        {"source":"windows-direct", "outcome":"not_configured", "winhttpError":null, "elapsedMs":5}
    ]);
    value["proxyConfig"] = json!({
        "autoDetect":true,"pacConfigured":false,"manualConfigured":false,"bypassConfigured":false,"environmentProxyPresent":true
    });
    let context = native_network_context(&format!("[alwith-native-network] {value}")).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let collector = Collector::new(directory.path().to_path_buf());
    collector.record("native_network", "failed", context);
    let report = collector.report();
    let network = &report["events"][0]["context"]["network"];
    assert_eq!(network["errorKind"], "tls");
    assert!(network["errorChain"][0]["debug"].as_str().unwrap().contains("-2146893019"));
    assert!(!network.to_string().contains("secret"));
    assert!(!network.to_string().contains("/private"));
    assert_eq!(network["proxySteps"][1]["winhttpError"], 12180);
    assert_eq!(network["proxySteps"][2]["outcome"], "not_configured");
    assert_eq!(network["proxyConfig"]["environmentProxyPresent"], true);
}

#[test]
fn native_network_extended_diagnostics_reject_unbounded_and_unknown_fields() {
    let original: Value =
        serde_json::from_str(native_network_line().strip_prefix("[alwith-native-network] ").unwrap()).unwrap();
    for (field, entry) in [
        ("errorChain", json!([{"message":"x".repeat(257),"debug":""}])),
        ("errorChain", json!([{"message":"ok","debug":"", "token":"secret"}])),
        ("errorChain", json!([{"message":"line\nbreak","debug":""}])),
        ("errorChain", json!(vec![json!({"message":"ok","debug":""}); 9])),
        ("proxySteps", json!([{"source":"raw-private-source","outcome":"read","winhttpError":null,"elapsedMs":0}])),
        (
            "proxySteps",
            json!([{"source":"windows-user","outcome":"raw-private-outcome","winhttpError":null,"elapsedMs":0}]),
        ),
        (
            "proxySteps",
            json!(vec![json!({"source":"windows-auto","outcome":"started","winhttpError":null,"elapsedMs":0}); 17]),
        ),
        (
            "proxyConfig",
            json!({"autoDetect":false,"pacConfigured":false,"manualConfigured":false,"bypassConfigured":false,"environmentProxyPresent":false,"pac":"secret"}),
        ),
    ] {
        let mut value = original.clone();
        value[field] = entry;
        assert!(native_network_context(&format!("[alwith-native-network] {value}")).is_none(), "accepted {field}");
    }
}

#[test]
fn native_transport_backend_is_bounded_and_survives_export() {
    let mut value: Value =
        serde_json::from_str(native_network_line().strip_prefix("[alwith-native-network] ").unwrap()).unwrap();
    value["transportBackend"] = json!("winhttp");
    let context = native_network_context(&format!("[alwith-native-network] {value}")).unwrap();
    assert_eq!(context.network.unwrap().transport_backend.as_deref(), Some("winhttp"));
    value["transportBackend"] = json!("raw private backend");
    assert!(native_network_context(&format!("[alwith-native-network] {value}")).is_none());
}
