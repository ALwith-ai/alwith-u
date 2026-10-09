use super::*;

fn request(path: &Path) -> InstallRequest {
    InstallRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        path: path.to_string_lossy().into_owned(),
        update: false,
        enable: false,
    }
}

#[test]
fn duplicate_requests_do_not_install_twice_and_reused_ids_cannot_change_paths() {
    let temp = tempfile::tempdir().unwrap();
    let control = Control::open(temp.path()).unwrap();
    let req = request(temp.path());
    control.admit(req.clone(), false).unwrap();
    control.admit(req.clone(), false).unwrap();
    assert_eq!(control.next().unwrap().unwrap().request_id(), req.request_id);
    assert!(control.next().unwrap().is_none());
    let mut changed = req;
    changed.enable = true;
    assert!(control.admit(changed, false).is_err());
}

#[test]
fn restart_marks_unfinished_requests_unknown_without_replaying_them() {
    let temp = tempfile::tempdir().unwrap();
    let req = request(temp.path());
    {
        let control = Control::open(temp.path()).unwrap();
        control.admit(req.clone(), false).unwrap();
        assert!(control.next().unwrap().is_some());
    }
    let restarted = Control::open(temp.path()).unwrap();
    let result = restarted.result(&req.request_id).unwrap().unwrap();
    assert_eq!(result.exit_code, 6);
    assert_eq!(result.error.unwrap().code, "resultUnknown");
    assert!(restarted.next().unwrap().is_none());
}

#[test]
fn completed_results_survive_restart_and_invalid_paths_are_not_queued() {
    let temp = tempfile::tempdir().unwrap();
    let control = Control::open(temp.path()).unwrap();
    let mut invalid = request(temp.path());
    invalid.path = "relative/path".into();
    assert!(control.admit(invalid, false).is_err());
    let req = request(temp.path());
    control.admit(req.clone(), false).unwrap();
    control.next().unwrap();
    let result = Outcome::failure(&req.request_id, 4, "installFailed", "hash mismatch");
    control.finish(result).unwrap();
    drop(control);
    let restarted = Control::open(temp.path()).unwrap();
    assert_eq!(restarted.result(&req.request_id).unwrap().unwrap().exit_code, 4);
}

#[test]
fn socket_rejects_unknown_operations_and_wrong_protocol_versions() {
    assert!(serde_json::from_str::<WireRequest>(r#"{"operation":"invoke","command":"delete_file"}"#).is_err());
    let req: WireRequest = serde_json::from_str(
        r#"{"operation":"result","protocolVersion":2,"requestId":"00000000-0000-0000-0000-000000000000"}"#,
    )
    .unwrap();
    assert!(req.validate().is_err());
}

#[test]
fn socket_roundtrip_acknowledges_once_then_returns_the_persisted_result() {
    let temp = tempfile::tempdir().unwrap();
    let control = Arc::new(Control::open(temp.path()).unwrap());
    let (mut client, server) = UnixStream::pair().unwrap();
    client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let req = request(temp.path());
    let worker_control = control.clone();
    let worker = thread::spawn(move || handle_connection(server, &worker_control, || Ok(())).unwrap());
    write_frame(&mut client, &WireRequest::Install { protocol_version: 1, request: req.clone() }).unwrap();
    let mut reader = BufReader::new(client);
    assert!(
        matches!(read_frame::<Frame>(&mut reader).unwrap(), Frame::Accepted { request_id } if request_id == req.request_id)
    );
    assert_eq!(control.next().unwrap().unwrap().request_id(), req.request_id);
    control.finish(Outcome::failure(&req.request_id, 5, "activationFailed", "missing capability")).unwrap();
    match read_frame::<Frame>(&mut reader).unwrap() {
        Frame::Result { result } => {
            assert_eq!(result.exit_code, 5);
            assert_eq!(result.request_id, req.request_id);
            assert_eq!(result.error.unwrap().code, "activationFailed");
        }
        _ => panic!("Expected terminal result"),
    }
    worker.join().unwrap();
}

#[test]
fn failed_host_startup_completes_queued_requests_and_rejects_new_admission() {
    let temp = tempfile::tempdir().unwrap();
    let control = Control::open(temp.path()).unwrap();
    let req = request(temp.path());
    control.admit(req.clone(), false).unwrap();
    control.unavailable("Extension runtime failed to initialize").unwrap();
    assert_eq!(control.result(&req.request_id).unwrap().unwrap().exit_code, 4);
    assert!(control.admit(request(temp.path()), false).is_err());
    assert!(control.next().unwrap().is_none());
}

#[test]
fn receipt_state_races_produce_a_terminal_unknown_result() {
    let mut actual = Outcome::failure("request", 4, "installFailed", "unexpected");
    actual.installed = true;
    actual.id = Some("notes".into());
    actual.version = Some("1.0.0".into());
    actual.package_revision = Some("revision".into());
    let report = Report {
        id: "notes".into(),
        version: "1.0.0".into(),
        package_revision: "revision".into(),
        installed: true,
        enabled: true,
        active_in_main_window: true,
        error: None,
    };
    // Another window disabled the extension after the main window produced its report.
    let reconciled = reconcile_report(actual, report, true, false);
    assert_eq!(reconciled.exit_code, 6);
    assert_eq!(reconciled.error.unwrap().code, "stateChanged");
    assert!(!reconciled.enabled);
}

#[test]
fn eviction_preserves_receipts_with_connected_waiters() {
    let temp = tempfile::tempdir().unwrap();
    let control = Control::open(temp.path()).unwrap();
    let mut req = request(temp.path());
    req.request_id = "00000000-0000-0000-0000-000000000000".into();
    control.admit(req.clone(), true).unwrap();
    control.next().unwrap();
    control.finish(Outcome::failure(&req.request_id, 4, "installFailed", "failure")).unwrap();
    {
        let mut records = control.records.lock().unwrap();
        for _ in 0..255 {
            let next = request(temp.path());
            records.insert(
                next.request_id.clone(),
                Record {
                    result: Some(Outcome::failure(&next.request_id, 4, "installFailed", "failure")),
                    request: next.into(),
                    processing: true,
                    selected_id: None,
                    waiters: 0,
                },
            );
        }
        control.save(&records).unwrap();
    }
    control.admit(request(temp.path()), false).unwrap();
    assert_eq!(control.result(&req.request_id).unwrap().unwrap().exit_code, 4);
}

#[test]
fn unavailable_control_does_not_require_a_working_cache() {
    let control = ExtensionControl::failed("Invalid control results".into());
    assert!(control.control().is_err());
    control.stop();
}

#[test]
fn unavailable_write_failure_still_rejects_admission_and_completes_waiters() {
    let temp = tempfile::tempdir().unwrap();
    let mut control = Control::open(temp.path()).unwrap();
    let req = request(temp.path());
    control.admit(req.clone(), false).unwrap();
    let original = control.root.clone();
    control.root = temp.path().join("missing");
    assert!(control.unavailable("Host failed").is_err());
    control.root = original;
    assert!(control.admit(request(temp.path()), false).is_err());
    assert_eq!(control.result(&req.request_id).unwrap().unwrap().exit_code, 4);
    assert!(control.next().unwrap().is_none());
}

#[test]
fn shutdown_after_acceptance_returns_unknown_outcome() {
    let temp = tempfile::tempdir().unwrap();
    let control = Arc::new(Control::open(temp.path()).unwrap());
    let (mut client, server) = UnixStream::pair().unwrap();
    client.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let req = request(temp.path());
    let worker_control = control.clone();
    let worker = thread::spawn(move || handle_connection(server, &worker_control, || Ok(())));
    write_frame(&mut client, &WireRequest::Install { protocol_version: 1, request: req.clone() }).unwrap();
    let mut reader = BufReader::new(client);
    assert!(matches!(read_frame::<Frame>(&mut reader).unwrap(), Frame::Accepted { .. }));
    control.running.store(false, Ordering::Release);
    control.changed.notify_all();
    let frame = read_frame::<Frame>(&mut reader);
    assert!(worker.join().unwrap().is_ok());
    match frame.unwrap() {
        Frame::Result { result } => {
            assert_eq!(result.request_id, req.request_id);
            assert_eq!(result.exit_code, 6);
            assert_eq!(result.error.unwrap().code, "resultUnknown");
        }
        _ => panic!("Expected unknown outcome"),
    }
}

#[test]
fn preparation_write_failures_requeue_only_undelivered_jobs() {
    for failure_stage in ["select", "finish"] {
        let temp = tempfile::tempdir().unwrap();
        let control = Control::open(temp.path()).unwrap();
        let req = request(temp.path());
        control.admit(req.clone(), false).unwrap();
        {
            let claim = control.claim_next().unwrap().unwrap();
            // A directory at the receipt destination makes atomic replacement fail.
            let receipt = temp.path().join("requests.json");
            let backup = temp.path().join("backup.json");
            fs::rename(&receipt, &backup).unwrap();
            fs::create_dir(&receipt).unwrap();
            let result = if failure_stage == "select" {
                control.select(&req.request_id, "notes")
            } else {
                control.finish(Outcome::failure(&req.request_id, 4, "prepareFailed", "invalid manifest"))
            };
            assert!(result.is_err());
            drop(claim);
            fs::remove_dir(&receipt).unwrap();
            fs::rename(&backup, &receipt).unwrap();
        }
        let claim = control.claim_next().unwrap().unwrap();
        assert_eq!(claim.request.request_id(), req.request_id);
        claim.deliver();
        assert!(control.claim_next().unwrap().is_none());
        assert!(control.result(&req.request_id).unwrap().is_none());
    }
}

#[test]
fn uninstall_requests_share_durable_queue_and_reject_reused_id_changes() {
    let temp = tempfile::tempdir().unwrap();
    let control = Control::open(temp.path()).unwrap();
    let request = UninstallRequest { request_id: uuid::Uuid::new_v4().to_string(), id: "notes".into(), purge: true };
    let wire = WireRequest::Uninstall { protocol_version: 1, request: request.clone() };
    let decoded: WireRequest = serde_json::from_slice(&serde_json::to_vec(&wire).unwrap()).unwrap();
    decoded.validate().unwrap();
    control.admit(request.clone(), false).unwrap();
    control.admit(request.clone(), false).unwrap();
    let claim = control.claim_next().unwrap().unwrap();
    assert!(matches!(&claim.request, ControlRequest::Uninstall(item) if item.id=="notes" && item.purge));
    claim.deliver();
    let mut changed = request.clone();
    changed.purge = false;
    assert!(control.admit(changed, false).is_err());
    let mut result = Outcome::failure(&request.request_id, 0, "unused", "unused");
    result.error = None;
    result.id = Some("notes".into());
    result.data_purged = Some(true);
    control.finish(result).unwrap();
    drop(control);
    let reopened = Control::open(temp.path()).unwrap();
    let result = reopened.result(&request.request_id).unwrap().unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.data_purged, Some(true));
}

#[test]
fn purge_private_files_removes_only_owned_data_and_refuses_links() {
    let temp = tempfile::tempdir().unwrap();
    for category in ["legacy-extension-files", "extension-files"] {
        fs::create_dir_all(temp.path().join(category).join("notes/nested")).unwrap();
        fs::write(temp.path().join(category).join("notes/nested/data"), "private").unwrap();
        fs::create_dir_all(temp.path().join(category).join("other")).unwrap();
    }
    purge_private_files(temp.path(), "notes").unwrap();
    purge_private_files(temp.path(), "notes").unwrap();
    for category in ["legacy-extension-files", "extension-files"] {
        assert!(!temp.path().join(category).join("notes").exists());
        assert!(temp.path().join(category).join("other").exists());
    }
    assert!(purge_private_files(temp.path(), "../escape").is_err());
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), temp.path().join("extension-files/notes")).unwrap();
    assert!(purge_private_files(temp.path(), "notes").is_err());
    assert!(outside.path().exists());
}
