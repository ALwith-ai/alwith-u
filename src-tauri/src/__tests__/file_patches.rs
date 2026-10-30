use alwith_fs::patch::{FilePatch, apply_patches};
use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::{TempDir, tempdir};

fn git(root: &Path, args: &[&str]) {
    assert!(Command::new("git").current_dir(root).args(args).output().unwrap().status.success());
}
fn repo() -> TempDir {
    let dir = tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    dir
}
fn modify(root: &Path, name: &str, old: &str, new: &str) -> FilePatch {
    FilePatch {
        old_path: Some(root.join(name)),
        new_path: Some(root.join(name)),
        patch: format!("--- ignored\n+++ ignored\n@@ -1 +1 @@\n-{old}\n+{new}\n"),
    }
}
#[test]
fn reverse_reapply_preserves_index_and_unrelated_files() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("a.txt"), "old\n").unwrap();
    git(root, &["add", "a.txt"]);
    fs::write(root.join("a.txt"), "new\n").unwrap();
    fs::write(root.join("user.txt"), "user edit").unwrap();
    let patch = modify(root, "a.txt", "old", "new");
    assert_eq!(apply_patches(root, std::slice::from_ref(&patch), true).unwrap().applied, [0]);
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "old\n");
    assert!(apply_patches(root, std::slice::from_ref(&patch), true).unwrap().failed.is_some());
    assert_eq!(apply_patches(root, &[patch], false).unwrap().applied, [0]);
    let index = Command::new("git").current_dir(root).args(["show", ":a.txt"]).output().unwrap();
    assert_eq!(index.stdout, b"old\n");
    assert_eq!(fs::read_to_string(root.join("user.txt")).unwrap(), "user edit");
}
#[test]
fn repeated_edits_reverse_in_order_and_stop_on_conflict() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("a"), "three\n").unwrap();
    let patches = [modify(root, "a", "one", "two"), modify(root, "a", "two", "three")];
    assert_eq!(apply_patches(root, &patches, true).unwrap().applied, [1, 0]);
    assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "one\n");
    assert_eq!(apply_patches(root, &patches, false).unwrap().applied, [0, 1]);
    fs::write(root.join("b"), "user changed\n").unwrap();
    let partial = [modify(root, "b", "before", "after"), patches[1].clone()];
    let result = apply_patches(root, &partial, true).unwrap();
    assert_eq!(result.applied, [1]);
    assert_eq!(result.failed.unwrap().index, 0);
    assert_eq!(fs::read_to_string(root.join("b")).unwrap(), "user changed\n");
    assert!(!root.join("b.rej").exists());
}
#[test]
fn additions_deletions_empty_files_and_renames_roundtrip() {
    let dir = repo();
    let root = dir.path();
    for name in ["space name.txt", "中文.txt"] {
        let patch = FilePatch {
            old_path: None,
            new_path: Some(root.join(name)),
            patch: "--- /dev/null\n+++ file\n@@ -0,0 +1 @@\n+hello\n".into(),
        };
        assert!(apply_patches(root, std::slice::from_ref(&patch), false).unwrap().failed.is_none());
        assert!(apply_patches(root, &[patch], true).unwrap().failed.is_none());
        assert!(!root.join(name).exists());
    }
    let empty =
        FilePatch { old_path: None, new_path: Some(root.join("empty")), patch: "new file mode 100644\n".into() };
    assert!(apply_patches(root, std::slice::from_ref(&empty), false).unwrap().failed.is_none());
    assert!(apply_patches(root, &[empty], true).unwrap().failed.is_none());
    fs::write(root.join("old"), "text\n").unwrap();
    let rename = FilePatch {
        old_path: Some(root.join("old")),
        new_path: Some(root.join("new")),
        patch: "similarity index 100%\nrename from old\nrename to new\n".into(),
    };
    assert!(apply_patches(root, std::slice::from_ref(&rename), false).unwrap().failed.is_none());
    assert!(!root.join("old").exists());
    assert!(apply_patches(root, &[rename], true).unwrap().failed.is_none());
    let delete = FilePatch {
        old_path: Some(root.join("old")),
        new_path: None,
        patch: "--- old\n+++ /dev/null\n@@ -1 +0,0 @@\n-text\n".into(),
    };
    assert!(apply_patches(root, std::slice::from_ref(&delete), false).unwrap().failed.is_none());
    assert!(apply_patches(root, &[delete], true).unwrap().failed.is_none());
    assert_eq!(fs::read_to_string(root.join("old")).unwrap(), "text\n");
}
#[test]
fn conflict_never_overwrites_later_edits_or_creates_markers() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("a"), "user edit\n").unwrap();
    let result = apply_patches(root, &[modify(root, "a", "before", "after")], true).unwrap();
    assert!(result.applied.is_empty());
    assert!(result.failed.is_some());
    assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "user edit\n");
}
#[test]
fn validates_all_paths_and_hunks_before_any_mutation() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("a"), "after\n").unwrap();
    for name in ["../outside", ".git/config"] {
        assert!(
            apply_patches(root, &[modify(root, name, "before", "after"), modify(root, "a", "before", "after")], true)
                .is_err()
        );
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "after\n");
    }
    let mut smuggled = modify(root, "a", "before", "after");
    smuggled.patch.push_str("--- a/other\n+++ b/other\n@@ -1 +1 @@\n-x\n+y\n");
    assert!(apply_patches(root, &[smuggled], true).is_err());
    let mut large = modify(root, "a", "before", "after");
    large.patch = "x".repeat(1_048_577);
    assert!(apply_patches(root, &[large], true).is_err());
    let mut binary = modify(root, "a", "before", "after");
    binary.patch = "GIT binary patch".into();
    assert!(apply_patches(root, &[binary], true).is_err());
    let outside = tempdir().unwrap();
    assert!(apply_patches(outside.path(), &[modify(outside.path(), "a", "a", "b")], true).is_err());
}
#[cfg(unix)]
#[test]
fn rejects_symlink_paths_and_symlink_parents() {
    let dir = repo();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("a"), "after\n").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
    assert!(apply_patches(dir.path(), &[modify(dir.path(), "linked/a", "before", "after")], true).is_err());
    assert_eq!(fs::read_to_string(outside.path().join("a")).unwrap(), "after\n");
}

#[test]
fn preserves_crlf_and_missing_final_newline() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("a"), b"new\r\n").unwrap();
    let mut patch = modify(root, "a", "old\r", "new\r");
    assert!(apply_patches(root, std::slice::from_ref(&patch), true).unwrap().failed.is_none());
    assert_eq!(fs::read(root.join("a")).unwrap(), b"old\r\n");
    fs::write(root.join("a"), b"new").unwrap();
    patch.patch =
        "--- a\n+++ a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n".into();
    assert!(apply_patches(root, &[patch], true).unwrap().failed.is_none());
    assert_eq!(fs::read(root.join("a")).unwrap(), b"old");
}
#[test]
fn nested_project_cannot_change_sibling_and_rejects_incomplete_payloads() {
    let dir = repo();
    let root = dir.path();
    let project = root.join("project");
    fs::create_dir(&project).unwrap();
    fs::write(project.join("a"), "new\n").unwrap();
    assert!(apply_patches(&project, &[modify(&project, "a", "old", "new")], true).unwrap().failed.is_none());
    assert!(apply_patches(&project, &[modify(root, "sibling", "old", "new")], true).is_err());
    let missing = FilePatch { old_path: None, new_path: Some(project.join("missing")), patch: "garbage".into() };
    assert!(apply_patches(&project, &[missing], false).is_err());
    assert!(!project.join("missing").exists());
    let mut mode = modify(&project, "a", "old", "new");
    mode.patch = "new file mode 120000\n".into();
    assert!(apply_patches(&project, &[mode], false).is_err());
}

#[test]
fn preserves_later_nonoverlapping_edits_in_the_same_file() {
    let dir = repo();
    let root = dir.path();
    let lines = "new\ncontext1\ncontext2\ncontext3\ncontext4\nuser's later edit\n";
    fs::write(root.join("a"), lines).unwrap();
    let mut patch = modify(root, "a", "old", "new");
    patch.patch = "--- a\n+++ a\n@@ -1,4 +1,4 @@\n-old\n+new\n context1\n context2\n context3\n".into();
    assert!(apply_patches(root, std::slice::from_ref(&patch), true).unwrap().failed.is_none());
    assert_eq!(fs::read_to_string(root.join("a")).unwrap(), lines.replacen("new", "old", 1));
    assert!(apply_patches(root, &[patch], false).unwrap().failed.is_none());
    assert_eq!(fs::read_to_string(root.join("a")).unwrap(), lines);
}
#[test]
fn rename_never_overwrites_an_existing_destination() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("old"), "original\n").unwrap();
    fs::write(root.join("new"), "user file\n").unwrap();
    let rename = FilePatch {
        old_path: Some(root.join("old")),
        new_path: Some(root.join("new")),
        patch: "rename from old\nrename to new\n".into(),
    };
    let result = apply_patches(root, &[rename], false).unwrap();
    assert!(result.applied.is_empty());
    assert!(result.failed.is_some());
    assert_eq!(fs::read_to_string(root.join("new")).unwrap(), "user file\n");
    assert_eq!(fs::read_to_string(root.join("old")).unwrap(), "original\n");
}
