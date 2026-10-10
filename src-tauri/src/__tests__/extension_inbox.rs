use super::*;
use std::path::Path;

fn source(root: &Path, name: &str) -> PathBuf {
    let path = root.join(name);
    fs::create_dir(&path).unwrap();
    fs::write(path.join("manifest.json"), r#"{"id":"notes","version":"1.0.0"}"#).unwrap();
    fs::write(path.join("main.js"), "module.exports = function() {};").unwrap();
    path
}

#[test]
fn claim_preserves_bytes_and_records_recoverable_identity() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "Notes 中文");
    let snapshot = tree(&input).unwrap();
    let task = claim(&inbox, &processing, "Notes 中文", &snapshot.fingerprint).unwrap();
    assert!(!input.exists());
    let root = task_root(&processing, &task.id).unwrap();
    assert_eq!(load(&root).unwrap().fingerprint, snapshot.fingerprint);
    assert_eq!(tree(&root.join("source")).unwrap().fingerprint, snapshot.fingerprint);
}

#[test]
fn changing_sources_are_not_claimed() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "notes");
    let snapshot = tree(&input).unwrap();
    fs::write(input.join("main.js"), "changed").unwrap();
    assert!(claim(&inbox, &processing, "notes", &snapshot.fingerprint).is_err());
    assert!(input.exists());
    assert_eq!(fs::read_dir(&processing).unwrap().count(), 0);
}

#[test]
fn cleanup_requires_commit_and_preserves_a_replacement_inbox_directory() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "notes");
    let mut task = claim(&inbox, &processing, "notes", &tree(&input).unwrap().fingerprint).unwrap();
    let root = task_root(&processing, &task.id).unwrap();
    assert!(cleanup(&root, &mut task).is_err());
    assert!(root.join("source").exists());
    let replacement = source(&inbox, "notes");
    task.committed = true;
    cleanup(&root, &mut task).unwrap();
    assert!(replacement.join("main.js").exists());
    assert!(!root.join("source").exists());
    assert!(load(&root).unwrap().cleaned);
    cleanup(&root, &mut task).unwrap();
}

#[test]
fn modified_claimed_sources_are_not_deleted() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "notes");
    let mut task = claim(&inbox, &processing, "notes", &tree(&input).unwrap().fingerprint).unwrap();
    let root = task_root(&processing, &task.id).unwrap();
    fs::write(root.join("source/new.txt"), "keep me").unwrap();
    task.committed = true;
    assert!(cleanup(&root, &mut task).is_err());
    assert!(root.join("source/new.txt").exists());
}

#[test]
fn task_paths_cannot_escape_processing_directory() {
    let temp = tempfile::tempdir().unwrap();
    assert!(task_root(temp.path(), "../outside").is_err());
    assert!(task_root(temp.path(), "/tmp").is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_files_and_directories_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let input = source(temp.path(), "notes");
    std::os::unix::fs::symlink(temp.path(), input.join("linked")).unwrap();
    assert!(tree(&input).is_err());
    assert!(remove_tree(&input).is_err());
    assert!(input.join("manifest.json").exists());
}

#[test]
fn resumed_partial_cleanup_rejects_new_files_and_accepts_only_original_remainders() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "notes");
    let mut task = claim(&inbox, &processing, "notes", &tree(&input).unwrap().fingerprint).unwrap();
    let root = task_root(&processing, &task.id).unwrap();
    task.committed = true;
    task.cleaning = true;
    task.cleanup_entries = Some(tree(&root.join("source")).unwrap().entries);
    save(&root, &task).unwrap();
    fs::remove_file(root.join("source/main.js")).unwrap();
    fs::write(root.join("source/new.txt"), "new input").unwrap();
    let mut recovered = load(&root).unwrap();
    assert!(cleanup(&root, &mut recovered).is_err());
    assert!(root.join("source/new.txt").exists());
    fs::remove_file(root.join("source/new.txt")).unwrap();
    cleanup(&root, &mut recovered).unwrap();
    assert!(!root.join("source").exists());
    assert!(load(&root).unwrap().cleaned);
}

#[tokio::test]
async fn scan_isolates_invalid_inputs_and_rejects_duplicate_ids() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let first = source(&inbox, "one");
    let second = source(&inbox, "two");
    let good = source(&inbox, "good");
    fs::write(good.join("manifest.json"), r#"{"id":"other"}"#).unwrap();
    fs::create_dir(inbox.join("broken")).unwrap();
    source(&inbox, ".partial");
    let result = scan(&inbox, &processing).await.unwrap();
    assert_eq!(result.tasks.len(), 1);
    assert_eq!(result.errors.len(), 3);
    assert!(first.exists() && second.exists());
    assert!(inbox.join(".partial").exists());
    let recovered = scan(&inbox, &processing).await.unwrap();
    assert_eq!(recovered.tasks, result.tasks);
}

#[cfg(unix)]
#[test]
fn non_utf8_names_are_reported_without_accessing_the_filesystem() {
    use std::os::unix::ffi::OsStringExt;
    let invalid = PathBuf::from(std::ffi::OsString::from_vec(vec![0xff]));
    assert!(input_name(&invalid).unwrap_err().contains("Non-UTF-8"));
    assert_eq!(input_name(Path::new(".partial")).unwrap(), None);
    assert_eq!(input_name(Path::new("notes")).unwrap(), Some("notes".into()));
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn non_utf8_names_do_not_prevent_valid_imports() {
    use std::os::unix::ffi::OsStringExt;
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    fs::create_dir(inbox.join(std::ffi::OsString::from_vec(vec![0xff]))).unwrap();
    source(&inbox, "notes");
    let result = scan(&inbox, &processing).await.unwrap();
    assert_eq!(result.tasks.len(), 1);
    assert_eq!(result.errors.len(), 1);
}

#[tokio::test]
async fn scan_recovers_a_claim_record_written_before_the_rename() {
    let temp = tempfile::tempdir().unwrap();
    let inbox = temp.path().join("inbox");
    let processing = temp.path().join("processing");
    directory(&inbox).unwrap();
    directory(&processing).unwrap();
    let input = source(&inbox, "notes");
    let task = claim(&inbox, &processing, "notes", &tree(&input).unwrap().fingerprint).unwrap();
    let root = task_root(&processing, &task.id).unwrap();
    fs::rename(root.join("source"), &input).unwrap();
    let result = scan(&inbox, &processing).await.unwrap();
    assert_eq!(result.tasks, vec![task.id]);
    assert!(result.errors.is_empty());
    assert_eq!(fs::read_dir(&processing).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn distinct_unix_filenames_cannot_hide_a_source_change() {
    let temp = tempfile::tempdir().unwrap();
    let input = source(temp.path(), "notes");
    fs::create_dir(input.join("assets")).unwrap();
    fs::write(input.join("assets/x.js"), "same").unwrap();
    let before = tree(&input).unwrap();
    fs::write(input.join("assets\\x.js"), "same").unwrap();
    assert_ne!(tree(&input).unwrap().fingerprint, before.fingerprint);
}
