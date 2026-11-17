#[cfg(target_os = "windows")]
mod windows_cef;

fn main() {
    println!("cargo:rerun-if-changed=capabilities");
    #[cfg(target_os = "windows")]
    {
        let destination =
            std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("resources/cef");
        if std::env::var_os("CARGO_FEATURE_RUNTIME_CEF").is_some() {
            println!("cargo:rerun-if-env-changed=DEP_TAURI_RUNTIME_CEF_CEF_DIR");
            let source = std::env::var_os("DEP_TAURI_RUNTIME_CEF_CEF_DIR")
                .expect("CEF runtime must expose its verified SDK directory");
            windows_cef::stage(std::path::Path::new(&source), &destination)
                .expect("failed to stage the NY CEF Windows distribution");
        } else {
            std::fs::create_dir_all(destination).expect("failed to create the Windows resource directory");
        }
    }
    let pattern = if std::env::var_os("CARGO_FEATURE_HASGARD_TESTING").is_some() {
        "./capabilities/**/*.json"
    } else {
        "./capabilities/*.json"
    };
    tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
        .expect("failed to build Tauri capabilities");
}
