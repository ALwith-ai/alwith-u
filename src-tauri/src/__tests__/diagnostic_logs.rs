use super::*;

#[test]
fn computer_snapshots_fit_the_total_budget_and_drop_a_cropped_first_line() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("ALwith U.log"), "app frame\n".repeat(500_000)).unwrap();
    let mut report = collect(directory.path(), "ALwith U");
    report.add_computer(
        Ok(format!("unlabelled-private-token\n{}", "driver frame\n".repeat(20_000))),
        "MCP tools/list failed\n".repeat(20_000),
    );
    assert!(report.files.iter().map(|file| file.content.len() as u64).sum::<u64>() <= TOTAL_BYTES);
    for file in &report.files[2..] {
        assert!(file.truncated);
        assert!(file.content.len() as u64 <= COMPUTER_BYTES);
        assert!(!file.content.contains("unlabelled-private-token"));
    }
    let mut report = collect(directory.path(), "ALwith U");
    report.add_computer(Err("driver status failed".into()), String::new());
    assert_eq!(report.files[2].read_error_kind.as_deref(), Some("Unavailable"));
    assert!(report.files[2].content.contains("driver status failed"));
    assert!(report.files[3].archive_path.is_some());
}

#[test]
fn export_includes_application_panic_and_recent_rotations_only() {
    let directory = tempfile::tempdir().unwrap();
    for (name, content) in [
        ("ALwith U.log", "[ERROR] bridge reset ECONNRESET\n"),
        ("panic.log", "panicked at native_network.rs:66\n  0: connection_task\n"),
        ("ALwith U_2026-11-03_11-48-00.log", "oldest\n"),
        ("ALwith U_2026-11-03_11-49-00.log", "older\n"),
        ("ALwith U_2026-11-03_11-50-00.log", "newer\n"),
        ("ALwith U_2026-11-03_11-51-00.log", "newest\n"),
        ("credentials.json", "private\n"),
        ("ALwith U_private.log", "private\n"),
    ] {
        fs::write(directory.path().join(name), content).unwrap();
    }
    let report = collect(directory.path(), "ALwith U");
    let names: Vec<_> = report.files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "ALwith U.log",
            "panic.log",
            "ALwith U_2026-11-03_11-51-00.log",
            "ALwith U_2026-11-03_11-50-00.log",
            "ALwith U_2026-11-03_11-49-00.log"
        ]
    );
    assert_eq!(report.omitted_files, 1);
    assert!(report.files[0].content.contains("ECONNRESET"));
    assert!(report.files[1].content.contains("native_network.rs:66"));
    assert!(report.files[1].content.contains("connection_task"));
    assert!(report.files.iter().all(|file| file.read_error_kind.is_none()));
}

#[test]
fn credentials_are_redacted_while_error_details_and_stack_frames_survive() {
    let text = r#"Authorization: Bearer secret-auth
Proxy-Authorization: Basic c2VjcmV0
{"api_key":"secret-key","accessToken":"secret-access","refresh_token":"secret-refresh","password":"secret-password"}
{\"api_key\":\"secret-escaped with spaces\"}
{"token":"secret-generic","sessionToken":"secret-session","secret":"secret-generic-secret"}
x-alwith-native-token: secret-native
Cookie: secret-cookie; second=secret-second-cookie
https://user:secret-url@chatgpt.com/backend-api/private?token=secret-query
http://127.0.0.1:51833/secret-route/responses
sk-abcdefgh12345678 eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYSJ9.signature
panicked at C:\Users\Alice\project\native_network.rs:66 ECONNRESET os error 10054
  0: /Users/Bob/project/src/native_network.rs:42 connection_task
"#;
    let output = redact(text);
    for secret in ["secret-", "with spaces", "c2VjcmV0", "abcdefgh12345678", "eyJhbGci", "Alice", "Bob", "user:"] {
        assert!(!output.contains(secret), "leaked {secret}: {output}");
    }
    for evidence in [
        "chatgpt.com",
        "127.0.0.1:51833",
        "native_network.rs:66",
        "native_network.rs:42",
        "ECONNRESET",
        "10054",
        "connection_task",
    ] {
        assert!(output.contains(evidence), "lost {evidence}");
    }
}

#[test]
fn tails_are_bounded_and_never_export_an_unlabelled_partial_credential() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("panic.log");
    fs::write(&path, format!("Authorization: Bearer {}\nlast panic frame\n", "x".repeat(100))).unwrap();
    let (size, content, truncated) = read_tail(&path, 48).unwrap();
    assert!(size > 48);
    assert!(truncated);
    assert_eq!(content, "last panic frame\n");
    fs::write(&path, "a".repeat(100)).unwrap();
    assert_eq!(read_tail(&path, 48).unwrap().1, "");
}

#[test]
fn export_has_a_total_budget_even_when_every_log_is_large() {
    let directory = tempfile::tempdir().unwrap();
    let content = "frame ECONNRESET\n".repeat(200_000);
    for name in [
        "ALwith U.log",
        "panic.log",
        "ALwith U_2026-11-03_11-51-00.log",
        "ALwith U_2026-11-03_11-50-00.log",
        "ALwith U_2026-11-03_11-49-00.log",
    ] {
        fs::write(directory.path().join(name), &content).unwrap();
    }
    let report = collect(directory.path(), "ALwith U");
    assert!(report.files.iter().all(|file| file.truncated));
    assert!(report.files.iter().map(|file| file.content.len() as u64).sum::<u64>() <= TOTAL_BYTES);
    for file in report.files {
        assert!(file.content.len() as u64 <= file.max_bytes);
    }
}

#[test]
fn missing_and_unreadable_logs_are_reported_without_failing_the_export() {
    let directory = tempfile::tempdir().unwrap();
    fs::create_dir(directory.path().join("panic.log")).unwrap();
    let report = collect(directory.path(), "ALwith U");
    assert_eq!(report.files[0].read_error_kind.as_deref(), Some("NotFound"));
    assert_eq!(report.files[1].read_error_kind.as_deref(), Some("InvalidInput"));
    assert!(report.files.iter().all(|file| file.content.is_empty()));
    let report = collect(&directory.path().join("missing"), "ALwith U");
    assert_eq!(report.directory_error_kind.as_deref(), Some("NotFound"));
    assert_eq!(report.files.len(), 2);
}
