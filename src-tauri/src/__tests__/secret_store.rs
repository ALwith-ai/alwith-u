use super::*;

#[test]
fn credentials_persist_independently_and_removal_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("credentials.json");
    let mut store = SecretStore::load(path.clone()).unwrap();
    assert_eq!(store.get("service-a"), None);
    store.replace(BTreeMap::from([("service-a".into(), "first".into())])).unwrap();
    store
        .replace(BTreeMap::from([("service-a".into(), "first".into()), ("service-b".into(), "other".into())]))
        .unwrap();
    store
        .replace(BTreeMap::from([("service-a".into(), "updated".into()), ("service-b".into(), "other".into())]))
        .unwrap();
    let mut restarted = SecretStore::load(path.clone()).unwrap();
    assert_eq!(restarted.get("service-a"), Some("updated"));
    restarted.replace(BTreeMap::from([("service-b".into(), "other".into())])).unwrap();
    let restarted = SecretStore::load(path).unwrap();
    assert_eq!(restarted.get("service-a"), None);
    assert_eq!(restarted.get("service-b"), Some("other"));
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn malformed_storage_is_rejected_without_overwriting_it() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("credentials.json");
    let original = "{invalid secret storage";
    std::fs::write(&path, original).unwrap();
    assert!(SecretStore::load(path.clone()).is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), original);
}

#[test]
fn failed_write_preserves_both_active_and_persisted_credentials() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("credentials.json");
    let mut store = SecretStore::load(path.clone()).unwrap();
    store.replace(BTreeMap::from([("service".into(), "saved".into())])).unwrap();
    store.path = directory.path().join("blocked").join("credentials.json");
    std::fs::write(directory.path().join("blocked"), "file").unwrap();
    assert!(store.replace(BTreeMap::from([("service".into(), "replacement".into())])).is_err());
    assert!(store.replace(BTreeMap::new()).is_err());
    assert_eq!(store.get("service"), Some("saved"));
    assert_eq!(SecretStore::load(path).unwrap().get("service"), Some("saved"));
}

#[cfg(unix)]
#[test]
fn existing_and_replaced_files_are_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("credentials.json");
    std::fs::write(&path, r#"{"service":"saved"}"#).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    let mut store = SecretStore::load(path.clone()).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    store.replace(BTreeMap::from([("service".into(), "updated".into())])).unwrap();
    assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn parse_errors_never_echo_secret_contents() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("credentials.json");
    std::fs::write(&path, r#""private-test-token""#).unwrap();
    let error = SecretStore::load(path).err().expect("invalid storage must be rejected");
    assert!(!error.contains("private-test-token"));
    assert!(error.starts_with("Invalid credential JSON at line "));
}
