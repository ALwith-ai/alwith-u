use super::{ARGUMENT, LoginLaunch};

#[cfg(target_os = "macos")]
#[test]
fn login_registration_requires_an_app_bundle_executable() {
    use std::path::Path;
    assert!(super::is_app_executable(Path::new("/Applications/ALwith U.app/Contents/MacOS/alwith-u")));
    for path in [
        "/project/src-tauri/target/debug/alwith-u",
        "/project/src-tauri/target/release/alwith-u",
        "/project.app/src-tauri/target/debug/alwith-u",
        "/Applications/ALwith U.app/alwith-u",
    ] {
        assert!(!super::is_app_executable(Path::new(path)), "{path}");
    }
}

#[test]
fn only_the_exact_login_argument_starts_hidden() {
    for arguments in [vec![], vec!["alwith-u"], vec!["--vibemon-autostart=false"]] {
        assert!(!LoginLaunch::new(arguments.into_iter().map(str::to_owned)).pending());
    }
    assert!(LoginLaunch::new(["alwith-u".into(), ARGUMENT.into()]).pending());
}

#[test]
fn manual_open_cancels_background_completion() {
    let launch = LoginLaunch::new([ARGUMENT.into()]);
    assert!(launch.finish());
    assert!(!launch.pending());
    assert!(!launch.finish());
    assert!(launch.started_hidden());
}
