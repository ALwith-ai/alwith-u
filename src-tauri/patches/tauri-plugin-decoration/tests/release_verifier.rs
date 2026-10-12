#![cfg(unix)]

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestRepository(PathBuf);

impl TestRepository {
    fn new(version: &str, tag: &str) -> Self {
        let suffix = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "tauri-decoration-release-verifier-{}-{suffix}",
            std::process::id()
        ));
        if root.exists() {
            fs::remove_dir_all(&root).expect("failed to remove stale release-verifier fixture");
        }
        fs::create_dir_all(root.join("src")).expect("failed to create release-verifier fixture");
        fs::write(
            root.join("Cargo.toml"),
            format!(
                "[package]\nname = \"tauri-plugin-decoration\"\nversion = \"{version}\"\nedition = \"2021\"\n"
            ),
        )
        .expect("failed to write fixture manifest");
        fs::write(root.join("src/lib.rs"), "pub fn fixture() {}\n")
            .expect("failed to write fixture source");

        run_ok(&root, "cargo", &["generate-lockfile"]);
        run_ok(&root, "git", &["init", "--quiet"]);
        run_ok(
            &root,
            "git",
            &["config", "user.email", "fixture@example.com"],
        );
        run_ok(&root, "git", &["config", "user.name", "Release Fixture"]);
        run_ok(&root, "git", &["add", "."]);
        run_ok(&root, "git", &["commit", "--quiet", "-m", "fixture"]);
        run_ok(&root, "git", &["tag", tag]);
        Self(root)
    }

    fn verify(&self, tag: &str) -> Output {
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join(".github/scripts/verify-release.sh");
        Command::new("bash")
            .arg(script)
            .arg(tag)
            .current_dir(&self.0)
            .output()
            .expect("failed to run release verifier")
    }
}

impl Drop for TestRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_ok(root: &Path, program: &str, arguments: &[&str]) -> Output {
    let output = Command::new(program)
        .args(arguments)
        .current_dir(root)
        .output()
        .unwrap_or_else(|error| panic!("failed to run {program}: {error}"));
    assert!(
        output.status.success(),
        "{program} {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
fn accepts_an_existing_exact_version_tag() {
    let repository = TestRepository::new("1.2.3", "v1.2.3");
    let output = repository.verify("v1.2.3");
    assert!(
        output.status.success(),
        "valid release was rejected: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let prerelease = TestRepository::new("1.2.3-rc.1+build.5", "v1.2.3-rc.1+build.5");
    let output = prerelease.verify("v1.2.3-rc.1+build.5");
    assert!(
        output.status.success(),
        "valid prerelease plus build metadata was rejected: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn rejects_missing_malformed_and_version_mismatched_tags() {
    let mismatched = TestRepository::new("1.2.3", "v1.2.4");
    let output = mismatched.verify("v1.2.4");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("release tag does not match Cargo package version"));

    let malformed = TestRepository::new("1.2.3", "release-1.2.3");
    let output = malformed.verify("release-1.2.3");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("strict v-prefixed SemVer"));

    let valid = TestRepository::new("1.2.3", "v1.2.3");
    let output = valid.verify("v9.9.9");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("does not exist"));
}
