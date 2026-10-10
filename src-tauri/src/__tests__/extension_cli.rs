use super::*;

#[test]
fn parser_requires_an_explicit_directory_and_does_not_accept_unknown_flags() {
    assert!(parse(&["extension", "install"]).is_err());
    assert!(parse(&["extension", "install", "--path", "/tmp", "--force"]).is_err());
    assert!(parse(&["extension", "install", "--path", "/tmp", "--timeout", "0"]).is_err());
    let parsed = parse(&["extension", "install", "--path", "/tmp", "--enable", "--update", "--json"]).unwrap();
    match parsed.command {
        Command::Install { path, enable, update } => {
            assert_eq!(path, PathBuf::from("/tmp"));
            assert!(enable && update);
        }
        _ => panic!("Expected install"),
    }
}

#[test]
fn result_lookup_preserves_request_identity_and_rejects_malformed_ids() {
    let id = "00000000-0000-0000-0000-000000000000";
    let parsed = parse(&["extension", "result", "--request-id", id, "--json"]).unwrap();
    assert!(matches!(parsed.command, Command::Result { request_id } if request_id == id));
    assert!(parse(&["extension", "result", "--request-id", "../other"]).is_err());
}

#[cfg(unix)]
#[test]
fn non_utf8_cli_arguments_are_rejected_without_panicking() {
    use std::os::unix::ffi::OsStringExt;
    let args = vec!["extension".into(), "install".into(), "--path".into(), std::ffi::OsString::from_vec(vec![0xff])];
    assert!(crate::extension_cli_args(args.into_iter()).is_err());
}

#[test]
fn acceptance_does_not_extend_the_overall_deadline() {
    let (client, mut server) = crate::extension_transport::tests::pair();
    client.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
    let worker = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        write_frame(&mut server, &Frame::Accepted { request_id: "request".into() }).unwrap();
        std::thread::sleep(Duration::from_millis(350));
        let _ = write_frame(
            &mut server,
            &Frame::Result { result: Outcome::failure("request", 5, "activationFailed", "too late") },
        );
    });
    let outcome = receive_result(client, "request", Instant::now() + Duration::from_millis(500));
    assert_eq!(outcome.exit_code, 6);
    assert_eq!(outcome.error.unwrap().code, "resultUnknown");
    worker.join().unwrap();
}

#[test]
fn errors_after_acceptance_are_unknown_but_rejections_are_failures() {
    for accepted in [false, true] {
        let (client, mut server) = crate::extension_transport::tests::pair();
        if accepted {
            write_frame(&mut server, &Frame::Accepted { request_id: "request".into() }).unwrap();
        }
        write_frame(&mut server, &Frame::Error { message: "Application stopped".into() }).unwrap();
        let result = receive_result(client, "request", Instant::now() + Duration::from_secs(1));
        assert_eq!(result.exit_code, if accepted { 6 } else { 4 });
    }
}

#[cfg(target_os = "macos")]
#[test]
fn closed_peer_preserves_the_buffered_terminal_result() {
    let (client, mut server) = crate::extension_transport::tests::pair();
    write_frame(&mut server, &Frame::Accepted { request_id: "request".into() }).unwrap();
    write_frame(
        &mut server,
        &Frame::Result { result: Outcome::failure("request", 4, "prepareFailed", "reviewed source mismatch") },
    )
    .unwrap();
    drop(server);
    let result = receive_result(client, "request", Instant::now() + Duration::from_secs(1));
    assert_eq!(result.exit_code, 4);
    assert_eq!(result.error.unwrap().code, "prepareFailed");
}

#[test]
fn uninstall_parser_requires_identity_and_accepts_explicit_purge() {
    assert!(parse(&["extension", "uninstall"]).is_err());
    assert!(parse(&["extension", "uninstall", "--id", "../escape"]).is_err());
    assert!(parse(&["extension", "install", "--path", "/tmp", "--purge"]).is_err());
    assert!(parse(&["extension", "uninstall", "--id", "weather", "--enable"]).is_err());
    assert!(parse(&["extension", "uninstall", "--id", "weather", "--purge", "--json"]).is_ok());
}

#[test]
fn windows_paths_with_spaces_and_unicode_remain_a_single_argument() {
    let source = r"C:\Users\测试用户\Extension Packages\notes";
    let parsed = parse(&["extension", "install", "--path", source, "--update", "--enable"]).unwrap();
    assert!(
        matches!(parsed.command, Command::Install { path, update: true, enable: true } if path == std::path::Path::new(source))
    );
}

#[cfg(windows)]
#[test]
fn malformed_utf16_arguments_are_rejected() {
    use std::os::windows::ffi::OsStringExt;
    let args = vec!["extension".into(), "install".into(), "--path".into(), std::ffi::OsString::from_wide(&[0xd800])];
    assert!(crate::extension_cli_args(args.into_iter()).is_err());
}

#[cfg(windows)]
#[test]
fn pipe_server_keeps_terminal_result_readable_until_client_closes() {
    let (client, mut server) = crate::extension_transport::tests::pair();
    let worker = std::thread::spawn(move || {
        write_frame(&mut server, &Frame::Accepted { request_id: "request".into() }).unwrap();
        write_frame(
            &mut server,
            &Frame::Result { result: Outcome::failure("request", 5, "activationFailed", "missing capability") },
        )
        .unwrap();
        crate::extension_transport::wait_for_peer_close(&mut server).unwrap();
    });
    let result = receive_result(client, "request", Instant::now() + Duration::from_secs(2));
    assert_eq!(result.exit_code, 5);
    assert_eq!(result.error.unwrap().code, "activationFailed");
    worker.join().unwrap();
}
