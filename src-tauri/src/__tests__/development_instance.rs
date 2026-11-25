use super::*;

#[test]
fn moves_profiles_without_changing_login_bytes_and_can_resume() {
    let root = tempfile::tempdir().unwrap();
    let paths = vec![(root.path().join("dev"), root.path().join("dev1"))];
    std::fs::create_dir(&paths[0].0).unwrap();
    std::fs::write(paths[0].0.join("Cookies"), b"existing session").unwrap();
    move_directories(&paths).unwrap();
    move_directories(&paths).unwrap();
    assert_eq!(std::fs::read(paths[0].1.join("Cookies")).unwrap(), b"existing session");
}

#[test]
fn checks_all_destinations_before_moving_any_profile() {
    let root = tempfile::tempdir().unwrap();
    let paths = vec![(root.path().join("a"), root.path().join("b")), (root.path().join("c"), root.path().join("d"))];
    for name in ["a", "c", "d"] {
        std::fs::create_dir(root.path().join(name)).unwrap();
    }
    assert!(move_directories(&paths).is_err());
    assert!(paths[0].0.exists());
    assert!(!paths[0].1.exists());
}

#[test]
fn only_additional_dev_instances_get_separate_codex_homes() {
    let data = Path::new("profile");
    for id in ["ai.alwith.u", "ai.alwith.u.dev", "ai.alwith.u.dev1", "ai.alwith.u.contract-test"] {
        assert_eq!(codex_home(id, data), None);
    }
    assert_eq!(codex_home("ai.alwith.u.dev2", data), Some(data.join("codex")));
    assert_eq!(codex_home("ai.alwith.u.dev12", data), Some(data.join("codex")));
}

#[test]
fn a_display_is_chosen_by_role_index_or_name() {
    let names = [Some("Built-in"), Some("Side")];
    assert_eq!(chosen("secondary", Some("Built-in"), &names), Some(1));
    assert_eq!(chosen("secondary", Some("Side"), &names), Some(0));
    assert_eq!(chosen("1", Some("Built-in"), &names), Some(1));
    assert_eq!(chosen("Side", Some("Built-in"), &names), Some(1));
    // One display has no secondary, and an index or name that is not there chooses nothing.
    assert_eq!(chosen("secondary", Some("Built-in"), &names[..1]), None);
    assert_eq!(chosen("2", Some("Built-in"), &names), None);
    assert_eq!(chosen("Other", Some("Built-in"), &names), None);
}
