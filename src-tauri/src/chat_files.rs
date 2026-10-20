use base64::Engine;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn write_payload(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    data: String,
    mime_type: String,
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatDroppedFile {
    path: String,
    name: String,
    image: Option<ChatImage>,
}

fn read_dropped_file(path: &Path) -> Result<ChatDroppedFile, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Only regular files can be attached to a chat".into());
    }
    let name = path.file_name().and_then(|name| name.to_str()).ok_or("Invalid file name")?.to_owned();
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let image = if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        // Match the shared composer's decimal 5 MB image budget and bound reads even if the file grows.
        const LIMIT: u64 = 5_000_000;
        if metadata.len() > LIMIT {
            return Err("Image exceeds the 5 MB attachment limit".into());
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .map_err(|error| error.to_string())?
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > LIMIT {
            return Err("Image exceeds the 5 MB attachment limit".into());
        }
        let mime_type = match image::guess_format(&bytes).map_err(|error| error.to_string())? {
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::WebP => "image/webp",
            image::ImageFormat::Gif => "image/gif",
            _ => return Err("Unsupported chat image format".into()),
        };
        Some(ChatImage { data: base64::engine::general_purpose::STANDARD.encode(bytes), mime_type: mime_type.into() })
    } else {
        None
    };
    Ok(ChatDroppedFile { path: path.to_str().ok_or("Invalid file path")?.to_owned(), name, image })
}

#[tauri3_specta::command]
pub async fn chat_read_dropped_file(window: tauri::WebviewWindow, path: String) -> Result<ChatDroppedFile, String> {
    if !matches!(window.label(), "main" | "chat") {
        return Err("Only chat windows can attach dropped files".into());
    }
    // A native drop explicitly selects a local file, including files outside the project.
    // File I/O must not occupy the desktop event loop.
    tauri::async_runtime::spawn_blocking(move || read_dropped_file(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

fn read_image(path: &Path, roots: &[PathBuf]) -> Result<ChatImage, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let mut allowed = false;
    for root in roots {
        match root.canonicalize() {
            Ok(root) => allowed |= path.starts_with(root),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    if !allowed {
        return Err("Image is outside the chat directory and generated-image directory".into());
    }
    if !path.metadata().map_err(|error| error.to_string())?.is_file() {
        return Err("Image preview requires a regular file".into());
    }
    const LIMIT: u64 = 32 * 1024 * 1024;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|error| error.to_string())?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Image exceeds the 32 MiB preview limit".into());
    }
    let format = image::guess_format(&bytes).map_err(|error| error.to_string())?;
    let mime_type = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::Bmp => "image/bmp",
        _ => return Err("Image format cannot be previewed".into()),
    };
    Ok(ChatImage { data: base64::engine::general_purpose::STANDARD.encode(bytes), mime_type: mime_type.into() })
}

#[tauri3_specta::command]
pub async fn chat_read_image(window: tauri::WebviewWindow, path: String, cwd: String) -> Result<ChatImage, String> {
    if !matches!(window.label(), "main" | "chat") {
        return Err("Only chat windows can preview chat images".into());
    }
    let roots = vec![
        PathBuf::from(cwd),
        window.app_handle().path().home_dir().map_err(|error| error.to_string())?.join(".codex/generated_images"),
    ];
    tauri::async_runtime::spawn_blocking(move || read_image(Path::new(&path), &roots))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri3_specta::command]
pub async fn chat_save_file(window: tauri::WebviewWindow, name: String, data: String) -> Result<bool, String> {
    if !matches!(window.label(), "main" | "chat") {
        return Err("Only chat windows can save chat attachments".into());
    }
    // Decode before showing the picker: malformed payloads must never overwrite a file.
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|error| error.to_string())?;
    let name = name.rsplit(['/', '\\']).next().filter(|name| !name.is_empty()).unwrap_or("attachment");
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window.dialog().file().set_parent(&window).set_file_name(name).save_file(move |path| {
        // Cancellation of the invoking window also drops its receiver.
        let _ = sender.send(path);
    });
    let Some(path) = receiver.await.map_err(|error| error.to_string())? else { return Ok(false) };
    let path = path.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || write_payload(&path, &bytes))
        .await
        .map_err(|error| error.to_string())??;
    Ok(true)
}

#[tauri3_specta::command]
pub async fn chat_write_text_attachment(
    window: tauri::WebviewWindow, name: String, text: String,
) -> Result<String, String> {
    if !matches!(window.label(), "main" | "chat") {
        return Err("Only chat windows can create chat attachments".into());
    }
    let name = name.rsplit(['/', '\\']).next().filter(|name| !name.is_empty()).unwrap_or("prompt.md");
    let directory =
        window.app_handle().path().app_cache_dir().map_err(|error| error.to_string())?.join("chat-attachments");
    let file_name = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    );
    let path = directory.join(format!("{file_name}-{name}"));
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        std::fs::write(&path, text).map_err(|error| error.to_string())?;
        path.to_str().map(str::to_owned).ok_or_else(|| "Invalid attachment path".into())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "__tests__/chat_files.rs"]
mod tests;

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatFilePreview {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    Unsupported,
}

fn read_file_preview(path: &Path) -> Result<ChatFilePreview, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    const LIMIT: u64 = 32 * 1024 * 1024;
    const TEXT_LIMIT: usize = 2 * 1024 * 1024;
    if !metadata.is_file() || metadata.len() > LIMIT {
        return Ok(ChatFilePreview::Unsupported);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|error| error.to_string())?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Ok(ChatFilePreview::Unsupported);
    }
    let mime_type = match image::guess_format(&bytes).ok() {
        Some(image::ImageFormat::Png) => Some("image/png"),
        Some(image::ImageFormat::Jpeg) => Some("image/jpeg"),
        Some(image::ImageFormat::WebP) => Some("image/webp"),
        Some(image::ImageFormat::Gif) => Some("image/gif"),
        Some(image::ImageFormat::Bmp) => Some("image/bmp"),
        _ => None,
    };
    if let Some(mime_type) = mime_type {
        return Ok(ChatFilePreview::Image {
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            mime_type: mime_type.into(),
        });
    }
    if bytes.len() <= TEXT_LIMIT
        && !bytes.contains(&0)
        && let Ok(text) = String::from_utf8(bytes)
    {
        return Ok(ChatFilePreview::Text { text });
    }
    Ok(ChatFilePreview::Unsupported)
}

/// Explicit file-link clicks may preview one external file without authorizing
/// its parent directory or creating a writable workspace.
#[tauri3_specta::command]
pub async fn chat_preview_file(window: tauri::WebviewWindow, path: String) -> Result<ChatFilePreview, String> {
    if !matches!(window.label(), "main" | "chat") {
        return Err("Only chat windows can preview linked files".into());
    }
    tauri::async_runtime::spawn_blocking(move || read_file_preview(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}
