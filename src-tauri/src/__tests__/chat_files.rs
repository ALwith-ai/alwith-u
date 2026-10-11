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

#[test]
fn dropped_files_outside_project_are_referenced_without_reading_their_contents() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("中文 space #1.txt");
    std::fs::write(&path, b"context").unwrap();
    let file = read_dropped_file(&path).unwrap();
    assert_eq!(file.path, path.canonicalize().unwrap().to_str().unwrap());
    assert_eq!(file.name, "中文 space #1.txt");
    assert!(file.image.is_none());
    assert!(read_dropped_file(directory.path()).is_err());
    assert!(read_dropped_file(&directory.path().join("missing.txt")).is_err());
}

#[test]
fn dropped_images_validate_contents_and_decimal_size_boundary() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.PNG");
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==";
    std::fs::write(&path, base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap();
    let image = read_dropped_file(&path).unwrap().image.unwrap();
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.data, png);
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(5_000_000).unwrap();
    assert!(read_dropped_file(&path).is_ok());
    file.set_len(5_000_001).unwrap();
    assert!(read_dropped_file(&path).unwrap_err().contains("5 MB"));
    std::fs::write(&path, b"not an image").unwrap();
    assert!(read_dropped_file(&path).is_err());
}

#[test]
fn previews_explicit_external_files_without_authorizing_a_workspace() {
    let directory = tempfile::tempdir().unwrap();
    let text = directory.path().join("中文 space #1.txt");
    std::fs::write(&text, "first\nsecond").unwrap();
    assert!(matches!(read_file_preview(&text).unwrap(), ChatFilePreview::Text { text } if text == "first\nsecond"));
    assert!(matches!(read_file_preview(directory.path()).unwrap(), ChatFilePreview::Unsupported));
    let binary = directory.path().join("binary.dat");
    std::fs::write(&binary, [0, 255, 7]).unwrap();
    assert!(matches!(read_file_preview(&binary).unwrap(), ChatFilePreview::Unsupported));
    let image = directory.path().join("image.png");
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSAAAAABJRU5ErkJggg==";
    std::fs::write(&image, base64::engine::general_purpose::STANDARD.decode(png).unwrap()).unwrap();
    assert!(
        matches!(read_file_preview(&image).unwrap(), ChatFilePreview::Image { data, mime_type } if data == png && mime_type == "image/png")
    );
    let large = directory.path().join("large.txt");
    std::fs::write(&large, vec![b'a'; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(matches!(read_file_preview(&large).unwrap(), ChatFilePreview::Unsupported));
    std::fs::File::create(&large).unwrap().set_len(32 * 1024 * 1024 + 1).unwrap();
    assert!(matches!(read_file_preview(&large).unwrap(), ChatFilePreview::Unsupported));
    assert!(read_file_preview(&directory.path().join("missing")).is_err());
}
