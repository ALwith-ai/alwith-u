use super::*;

#[test]
fn reports_append_without_overwriting_previous_crashes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("panic.log");
    append_report(&path, "first crash\n").unwrap();
    append_report(&path, "second crash\n").unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), "first crash\nsecond crash\n");
}

#[test]
fn report_destination_errors_are_propagated() {
    let directory = tempfile::tempdir().unwrap();
    assert!(append_report(directory.path(), "crash").is_err());
    assert!(append_report(&directory.path().join("missing/panic.log"), "crash").is_err());
}

#[test]
fn unavailable_destination_does_not_prevent_installation_or_later_reports() {
    const CHILD_DIRECTORY: &str = "ALWITH_PANIC_REPORT_TEST_DIRECTORY";
    if let Some(directory) = std::env::var_os(CHILD_DIRECTORY) {
        let directory = PathBuf::from(directory).join("initially-missing");
        let path = directory.join("panic.log");
        install(path.clone());
        std::fs::create_dir(&directory).unwrap();
        let result = std::panic::catch_unwind(|| panic!("panic-report-recovery-marker"));
        assert!(result.is_err());
        let report = std::fs::read_to_string(path).expect("installed hook must retry writing after recovery");
        assert!(report.contains("panic-report-recovery-marker"));
        assert!(report.contains("ALwith U"));
        return;
    }

    // Isolate the process-wide hook from other tests running concurrently.
    let directory = tempfile::tempdir().unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "panic_report::tests::unavailable_destination_does_not_prevent_installation_or_later_reports",
            "--nocapture",
        ])
        .env(CHILD_DIRECTORY, directory.path())
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}
