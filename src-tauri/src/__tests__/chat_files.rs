use super::*;

#[test]
fn saves_exact_binary_bytes_and_propagates_write_failures() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("report.bin");
    let bytes = [0, 255, 10, 128];
    write_payload(&file, &bytes).unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    assert!(write_payload(directory.path(), &bytes).is_err());
    assert!(write_payload(&directory.path().join("missing/report.bin"), &bytes).is_err());
}

#[test]
fn previews_image_bytes_within_the_owning_directory() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("portrait.png");
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==";
    std::fs::write(&file, base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap();
    let result = read_image(&file, &[directory.path().to_path_buf()]).unwrap();
    assert_eq!(result.mime_type, "image/png");
    assert_eq!(result.data, png);
    assert!(read_image(&file, &[directory.path().join("missing")]).is_err());
    let invalid = directory.path().join("fake.png");
    std::fs::write(&invalid, b"not an image").unwrap();
    assert!(read_image(&invalid, &[directory.path().to_path_buf()]).is_err());
}

#[test]
fn rejects_oversized_previews() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("large.png");
    let output = std::fs::File::create(&file).unwrap();
    output.set_len(32 * 1024 * 1024 + 1).unwrap();
    assert!(read_image(&file, &[directory.path().to_path_buf()]).unwrap_err().contains("32 MiB"));
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_outside_the_preview_roots() {
    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("private.png");
    std::fs::write(&file, b"private").unwrap();
    let link = directory.path().join("link.png");
    std::os::unix::fs::symlink(file, &link).unwrap();
    assert!(read_image(&link, &[directory.path().to_path_buf()]).is_err());
}
