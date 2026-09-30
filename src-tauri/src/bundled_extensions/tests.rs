use super::*;
use image::ImageFormat;

#[test]
fn bundled_extension_installs_and_serves_real_jpeg_resources() {
    const EXTENSION_ID: &str = "host-images";
    const BUNDLED_SOURCE: &str = "bundled:alwith-u";
    use alwith_extension::{Request, Response, Service};
    let root = tempfile::tempdir().unwrap();
    let mut service = Service::open(root.path()).unwrap();
    let packages = tempfile::tempdir().unwrap();
    fixture_package(packages.path(), EXTENSION_ID);
    let package = packages.path().join(EXTENSION_ID);
    fs::create_dir(package.join("assets")).unwrap();
    image::RgbImage::new(2, 2).save(package.join("assets/test.jpg")).unwrap();
    fs::write(package.join("data.json"), r#"{"id":"test","brightness":100}"#).unwrap();
    let bundles = resolve_bundles(packages.path()).unwrap();
    assert_eq!(bundles.len(), 1);
    assert_eq!(bundles[0].id, EXTENSION_ID);
    let dispatch = |service: &mut Service, value: serde_json::Value| {
        service.dispatch("main", serde_json::from_value::<Request>(value).unwrap()).unwrap()
    };
    dispatch(
        &mut service,
        serde_json::json!({"type":"installLocal", "path": package, "source": BUNDLED_SOURCE, "expectedId": EXTENSION_ID, "expectedVersion": "1.0.0"}),
    );
    let snapshot = service.snapshot();
    let installation = &snapshot.installations[0];
    assert_eq!(installation.manifest.name, EXTENSION_ID);
    assert_eq!(installation.source, BUNDLED_SOURCE);
    dispatch(&mut service, serde_json::json!({"type":"enable", "id": EXTENSION_ID}));
    let Response::Token { activation } =
        dispatch(&mut service, serde_json::json!({"type":"register", "id": EXTENSION_ID}))
    else {
        panic!("activation expected")
    };
    let (bytes, mime) = service.resource_for_window("main", &activation.token, "assets/test.jpg").unwrap();
    assert_eq!(mime, "image/jpeg");
    assert_eq!(image::guess_format(&bytes).unwrap(), ImageFormat::Jpeg);
    let (defaults, mime) = service.resource_for_window("main", &activation.token, "data.json").unwrap();
    assert_eq!(mime, "application/json");
    let defaults: serde_json::Value = serde_json::from_slice(&defaults).unwrap();
    assert_eq!(defaults["id"], "test");
    assert_eq!(defaults["brightness"], 100);
    assert!(matches!(
        dispatch(&mut service, serde_json::json!({"type":"readData", "token": activation.token})),
        Response::Data { data: None }
    ));
    assert!(service.resource_for_window("settings", &activation.token, "assets/test.jpg").is_err());
    dispatch(&mut service, serde_json::json!({"type":"beginTransition", "action":"disable", "id": EXTENSION_ID}));
    assert!(service.resource_for_window("main", &activation.token, "assets/test.jpg").is_err());
    dispatch(&mut service, serde_json::json!({"type":"release", "token": activation.token}));
    dispatch(&mut service, serde_json::json!({"type":"commitTransition", "id": EXTENSION_ID}));
    assert!(!service.snapshot().installations[0].enabled);
}

fn fixture_package(root: &Path, id: &str) {
    let path = root.join(id);
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join("main.js"), "exports.activate = () => {};\n").unwrap();
    fs::write(
        path.join("manifest.json"),
        serde_json::json!({
            "manifestVersion": 3, "id": id, "name": id, "version": "1.0.0", "entry": "main.js",
            "dependencies": { "@alwith/module-extension": "^0.1.0" }, "dataSchemaVersion": 1
        })
        .to_string(),
    )
    .unwrap();
}

#[test]
fn discovers_resources_without_configuration_entries() {
    let root = tempfile::tempdir().unwrap();
    fixture_package(root.path(), "host-notes");
    fixture_package(root.path(), "host-clock");
    fs::write(root.path().join(".DS_Store"), "metadata").unwrap();
    let bundles = resolve_bundles(root.path()).unwrap();
    assert_eq!(bundles.len(), 2);
    assert_eq!(bundles[0].id, "host-clock");
    assert_eq!(bundles[1].id, "host-notes");
    assert_eq!(bundles[1].source, "bundled:alwith-u");
    assert_eq!(bundles[1].version, "1.0.0");
    assert_eq!(Path::new(&bundles[1].path), root.path().join("host-notes"));
}

#[test]
fn empty_resource_directory_is_valid_but_missing_root_is_reported() {
    let root = tempfile::tempdir().unwrap();
    assert!(resolve_bundles(root.path()).unwrap().is_empty());
    assert!(resolve_bundles(&root.path().join("missing")).unwrap_err().contains("Read bundled extensions"));
}

#[test]
fn rejects_invalid_directory_and_missing_or_malformed_manifest() {
    for (id, manifest) in [("invalid.name", None), ("host-clock", None), ("host-clock", Some("not json"))] {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(id);
        fs::create_dir(&path).unwrap();
        if let Some(content) = manifest {
            fs::write(path.join("manifest.json"), content).unwrap();
        }
        assert!(resolve_bundles(root.path()).is_err(), "{id}: {manifest:?}");
    }
}

#[test]
fn rejects_duplicate_and_mismatched_manifest_identities() {
    for duplicate in [false, true] {
        let root = tempfile::tempdir().unwrap();
        if duplicate {
            fixture_package(root.path(), "host-clock");
        }
        fixture_package(root.path(), "host-notes");
        let path = root.path().join("host-notes/manifest.json");
        let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["id"] = "host-clock".into();
        fs::write(path, manifest.to_string()).unwrap();
        let error = resolve_bundles(root.path()).unwrap_err();
        assert!(error.contains(if duplicate { "Duplicate" } else { "identity mismatch" }));
    }
}

#[test]
fn shipped_resources_currently_contain_no_extension_apps() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/extensions");
    let bundles = resolve_bundles(&root).unwrap();
    assert!(bundles.is_empty());
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_bundle_directory_and_manifest() {
    for manifest_link in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fixture_package(outside.path(), "host-clock");
        if manifest_link {
            fs::create_dir(root.path().join("host-clock")).unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("host-clock/manifest.json"),
                root.path().join("host-clock/manifest.json"),
            )
            .unwrap();
        } else {
            std::os::unix::fs::symlink(outside.path().join("host-clock"), root.path().join("host-clock")).unwrap();
        }
        assert!(resolve_bundles(root.path()).unwrap_err().contains("symbolic links"));
    }
}
