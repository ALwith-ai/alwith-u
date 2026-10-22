#[rustfmt::skip]
#[path = "../../patches/wry/src/wkwebview/drag_drop/file_url.rs"]
mod file_url;

use file_url::resolve_file_url;
use objc2_foundation::{NSString, NSURL};

#[test]
fn finder_file_reference_resolves_to_readable_path_after_rename() {
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("download.txt");
    std::fs::write(&original, "dropped file").unwrap();
    let url = NSURL::fileURLWithPath(&NSString::from_str(original.to_str().unwrap()));
    let reference = url.fileReferenceURL().unwrap();
    assert!(reference.isFileReferenceURL());
    let value = reference.absoluteString().unwrap();
    assert!(value.to_string().contains("/.file/id="));

    let renamed = directory.path().join("中文 space #100%.txt");
    std::fs::rename(&original, &renamed).unwrap();
    let resolved = resolve_file_url(&value).unwrap();
    assert_eq!(resolved.canonicalize().unwrap(), renamed.canonicalize().unwrap());
    assert_eq!(std::fs::read_to_string(resolved).unwrap(), "dropped file");
}

#[test]
fn regular_file_urls_preserve_unicode_and_encoded_characters() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("中文 space #100%.txt");
    std::fs::write(&path, "plain file").unwrap();
    let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str().unwrap()));
    let resolved = resolve_file_url(&url.absoluteString().unwrap()).unwrap();
    assert_eq!(resolved, path);
    assert_eq!(std::fs::read_to_string(resolved).unwrap(), "plain file");
}

#[test]
fn rejects_non_file_urls_and_unresolvable_references() {
    for value in ["https://example.com/file.txt", "relative.txt", "file:///.file/id=0.0", "http://["] {
        assert!(resolve_file_url(&NSString::from_str(value)).is_none(), "{value}");
    }
}
