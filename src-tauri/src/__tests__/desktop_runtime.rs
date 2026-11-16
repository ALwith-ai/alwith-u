use super::*;

#[test]
fn browser_settings_use_the_existing_application_data_directory() {
    let identifier = "ai.alwith.u.dev";
    let expected = dirs::data_dir().unwrap().join(identifier);
    assert_eq!(application_data(identifier).unwrap(), expected);
    #[cfg(target_os = "windows")]
    assert!(expected.starts_with(std::env::var_os("APPDATA").unwrap()));
    #[cfg(target_os = "macos")]
    assert!(expected.ends_with("Library/Application Support/ai.alwith.u.dev"));
}

#[test]
fn browser_capabilities_allow_switching_only_in_development() {
    let capabilities = runtime_capabilities();
    assert_eq!(capabilities.backend, Backend::Cef);
    assert_eq!(capabilities.embedded_browser, cfg!(feature = "experimental-cef"));
    assert_eq!(capabilities.can_switch_backend, cfg!(feature = "dev-backends"));
}
