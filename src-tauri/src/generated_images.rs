use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const DIRECTORY: &str = "generated_images";
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    mime_type: String,
    data: String,
}

fn component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn image_type(bytes: &[u8]) -> Result<(&'static str, &'static str), String> {
    match image::guess_format(bytes) {
        Ok(image::ImageFormat::Png) => Ok(("image/png", "png")),
        Ok(image::ImageFormat::Jpeg) => Ok(("image/jpeg", "jpg")),
        Ok(image::ImageFormat::WebP) => Ok(("image/webp", "webp")),
        _ => Err("Unsupported generated image format".into()),
    }
}

fn contained_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let meta = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !meta.is_dir() || meta.is_symlink() {
        return Err("Generated image directory must be a regular directory".into());
    }
    Ok(path)
}

fn save_images(
    home: &Path, session_id: &str, call_id: &str, images: Vec<GeneratedImage>,
) -> Result<Vec<String>, String> {
    if !component(session_id) || !component(call_id) || images.is_empty() || images.len() > 16 {
        return Err("Invalid generated image batch".into());
    }
    let images = images
        .into_iter()
        .map(|image| {
            if image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
                return Err("Generated image exceeds the 32 MiB limit".into());
            }
            let bytes = STANDARD.decode(image.data).map_err(|error| error.to_string())?;
            let (mime, extension) = image_type(&bytes)?;
            if bytes.len() > MAX_IMAGE_BYTES || mime != image.mime_type {
                return Err("Invalid generated image data".into());
            }
            Ok((bytes, extension))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let root = contained_directory(home, DIRECTORY)?;
    let folder = contained_directory(&root, session_id)?;
    images
        .into_iter()
        .enumerate()
        .map(|(index, (bytes, extension))| {
            let name = format!("alwith-{call_id}-{}.{extension}", index + 1);
            let path = folder.join(&name);
            let reference = format!("{DIRECTORY}/{session_id}/{name}");
            let mut temp = tempfile::NamedTempFile::new_in(&folder).map_err(|error| error.to_string())?;
            temp.write_all(&bytes).map_err(|error| error.to_string())?;
            temp.as_file().sync_all().map_err(|error| error.to_string())?;
            if let Err(error) = temp.persist_noclobber(&path)
                && (error.error.kind() != io::ErrorKind::AlreadyExists || read_bytes(home, &reference)? != bytes)
            {
                return Err(error.error.to_string());
            }
            Ok(reference)
        })
        .collect()
}

fn read_bytes(home: &Path, reference: &str) -> Result<Vec<u8>, String> {
    let parts: Vec<_> = reference.split('/').collect();
    let [DIRECTORY, session, name] = parts.as_slice() else {
        return Err("Invalid generated image reference".into());
    };
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return Err("Invalid generated image name".into());
    };
    let valid_name = stem.strip_prefix("alwith-").is_some_and(|stem| {
        stem.rsplit_once('-').is_some_and(|(call, index)| component(call) && matches!(index.parse::<u8>(), Ok(1..=16)))
    });
    if !component(session) || !valid_name || !matches!(extension, "png" | "jpg" | "webp") {
        return Err("Invalid generated image reference".into());
    }
    let root = home.join(DIRECTORY);
    let folder = root.join(session);
    let path = folder.join(name);
    for directory in [&root, &folder] {
        if !fs::symlink_metadata(directory).map_err(|error| error.to_string())?.is_dir() {
            return Err("Invalid generated image directory".into());
        }
    }
    if !fs::symlink_metadata(&path).map_err(|error| error.to_string())?.is_file() {
        return Err("Invalid generated image file".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Generated image exceeds the 32 MiB limit".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn save_generated_images(
    app: tauri::AppHandle, session_id: String, call_id: String, images: Vec<GeneratedImage>,
) -> Result<Vec<String>, String> {
    let home = crate::codex_home::resolve(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || save_images(&home, &session_id, &call_id, images))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn read_generated_image(app: tauri::AppHandle, reference: String) -> Result<GeneratedImage, String> {
    let home = crate::codex_home::resolve(&app).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_bytes(&home, &reference)?;
        let (mime, _) = image_type(&bytes)?;
        Ok(GeneratedImage { mime_type: mime.into(), data: STANDARD.encode(bytes) })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ExtendedColorType, ImageEncoder, codecs::png::PngEncoder};

    #[test]
    fn generated_images_survive_reopen_without_reencoding() {
        let home = tempfile::tempdir().unwrap();
        let mut pixels = vec![0; 640 * 640 * 3];
        let mut seed = 1983_u32;
        for byte in &mut pixels {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            *byte = seed as u8;
        }
        let mut original = Vec::new();
        PngEncoder::new(&mut original).write_image(&pixels, 640, 640, ExtendedColorType::Rgb8).unwrap();
        assert!(original.len() > 1024 * 1024);
        let images = || vec![GeneratedImage { mime_type: "image/png".into(), data: STANDARD.encode(&original) }];
        let references = save_images(home.path(), "thread-1", "exec-1", images()).unwrap();
        assert_eq!(references, ["generated_images/thread-1/alwith-exec-1-1.png"]);
        assert_eq!(save_images(home.path(), "thread-1", "exec-1", images()).unwrap(), references);
        assert_eq!(read_bytes(home.path(), &references[0]).unwrap(), original);
        assert!(read_bytes(home.path(), "generated_images/../alwith-exec-1-1.png").is_err());
    }
}
