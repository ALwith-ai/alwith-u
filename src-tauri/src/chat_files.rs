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

#[cfg(test)]
#[path = "__tests__/chat_files.rs"]
mod tests;
