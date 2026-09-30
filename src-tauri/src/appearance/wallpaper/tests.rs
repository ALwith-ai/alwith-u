use super::*;
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

fn picture() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8, 4).write_to(&mut bytes, ImageFormat::Png).unwrap();
    bytes.into_inner()
}
#[test]
fn imported_image_survives_source_and_validates_identity() {
    let root = tempfile::tempdir().unwrap();
    let library = ImageLibrary::new(root.path().to_path_buf());
    let item = library.import_bytes("sample.png", &picture()).unwrap();
    assert_eq!((item.width, item.height), (8, 4));
    assert_eq!(library.list().unwrap().len(), 1);
    assert!(library.read(&item.id).unwrap().starts_with(b"\x89PNG"));
    assert!(library.read("../state.json").is_err());
    library.remove(&item.id).unwrap();
    assert!(library.list().unwrap().is_empty());
    assert!(library.read(&item.id).is_ok(), "other windows may still reference an image removed from the library");
}
#[test]
fn invalid_and_oversized_images_do_not_enter_library() {
    let root = tempfile::tempdir().unwrap();
    let library = ImageLibrary::new(root.path().to_path_buf());
    assert!(library.import_bytes("not.png", b"not a picture").is_err());
    assert!(library.import_bytes("large.png", &vec![0; MAX_IMAGE_BYTES + 1]).is_err());
    let mut wide = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8193, 1).write_to(&mut wide, ImageFormat::Png).unwrap();
    assert!(library.import_bytes("wide.png", &wide.into_inner()).is_err());
    assert!(library.list().unwrap().is_empty());
}

#[test]
fn jpeg_orientation_and_webp_import_as_static_images() {
    let root = tempfile::tempdir().unwrap();
    let library = ImageLibrary::new(root.path().to_path_buf());
    let mut jpeg = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8, 4).write_to(&mut jpeg, ImageFormat::Jpeg).unwrap();
    // EXIF orientation 6: a phone portrait stored as landscape pixels.
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend_from_slice(exif);
    oriented.extend_from_slice(&jpeg.get_ref()[2..]);
    let item = library.import_bytes("portrait.jpg", &oriented).unwrap();
    assert_eq!((item.width, item.height), (4, 8));
    assert_eq!(image::load_from_memory(&library.read(&item.id).unwrap()).unwrap().height(), 8);
    let mut webp = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8, 4).write_to(&mut webp, ImageFormat::WebP).unwrap();
    let item = library.import_bytes("sample.webp", webp.get_ref()).unwrap();
    assert_eq!((item.width, item.height), (8, 4));
    assert_eq!(library.list().unwrap().len(), 2);
}

#[test]
fn wallpaper_dialog_uses_one_application_language() {
    let chinese = WallpaperDialogText::for_locale(Some("zh-CN"));
    assert_eq!((chinese.title, chinese.remove, chinese.cancel), ("壁纸", "移除", "取消"));
    assert_eq!(chinese.import_title, "导入壁纸");
    assert_eq!(
        chinese.removal_message("sheet.webp"),
        "从图库移除“sheet.webp”？\n原文件和已保存副本会保留，不释放磁盘空间。"
    );
    let english = WallpaperDialogText::for_locale(Some("en"));
    assert_eq!((english.title, english.remove, english.cancel), ("Wallpaper", "Remove", "Cancel"));
    assert!(english.removal_message("sheet.webp").starts_with("Remove “sheet.webp”"));
    assert!(!english.removal_message("sheet.webp").contains("图库"));
    assert_eq!(WallpaperDialogText::for_locale(None).title, "Wallpaper");
}
