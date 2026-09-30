use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
};
use tauri::{Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
pub struct ImportedImage {
    id: String,
    name: String,
    width: u32,
    height: u32,
}
struct ImageLibrary {
    root: PathBuf,
}
impl ImageLibrary {
    fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn directory(&self, id: &str) -> Result<PathBuf, String> {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid wallpaper identity")?;
        if parsed.to_string() != id {
            return Err("Invalid wallpaper identity".into());
        }
        let directory = self.root.join(id);
        if fs::symlink_metadata(&directory).map_err(|e| e.to_string())?.file_type().is_symlink() {
            return Err("Wallpaper links are unsupported".into());
        }
        Ok(directory)
    }
    fn import_bytes(&self, name: &str, bytes: &[u8]) -> Result<ImportedImage, String> {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err("Image exceeds 20 MiB / 图片超过 20 MiB".into());
        }
        let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
        if !matches!(reader.format(), Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)) {
            return Err("Only PNG, JPEG and WebP are supported / 仅支持 PNG、JPEG 和 WebP".into());
        }
        let mut limits = Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);
        let mut decoder = reader
            .into_decoder()
            .map_err(|e| format!("Invalid image (maximum edge 8192 px) / 图片无效或尺寸超限: {e}"))?;
        if decoder.total_bytes() > 256 * 1024 * 1024 {
            return Err("Decoded image exceeds 256 MiB / 解码后的图片超过 256 MiB".into());
        }
        let orientation = decoder.orientation().map_err(|e| e.to_string())?;
        let mut decoded = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
        decoded.apply_orientation(orientation);
        let image = ImportedImage {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            width: decoded.width(),
            height: decoded.height(),
        };
        let mut normalized = Cursor::new(Vec::new());
        decoded.write_to(&mut normalized, ImageFormat::Png).map_err(|e| e.to_string())?;
        if normalized.get_ref().len() > MAX_IMAGE_BYTES {
            return Err("Normalized image exceeds 20 MiB / 转换后的图片超过 20 MiB".into());
        }
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let temporary =
            tempfile::Builder::new().prefix(".import-").tempdir_in(&self.root).map_err(|e| e.to_string())?;
        for (name, bytes) in [
            ("image.png", normalized.into_inner()),
            ("metadata.json", serde_json::to_vec(&image).map_err(|e| e.to_string())?),
        ] {
            let mut file = fs::File::create(temporary.path().join(name)).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        fs::rename(temporary.path(), self.root.join(&image.id)).map_err(|e| e.to_string())?;
        Ok(image)
    }
    fn list(&self) -> Result<Vec<ImportedImage>, String> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.to_string()),
        };
        let mut images = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let directory = self.directory(&name)?;
            if directory.join("removed").try_exists().map_err(|e| e.to_string())? {
                continue;
            }
            let image: ImportedImage =
                serde_json::from_slice(&fs::read(directory.join("metadata.json")).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if image.id != name {
                return Err("Wallpaper metadata does not match its identity".into());
            }
            images.push(image);
        }
        images.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        Ok(images)
    }
    fn read(&self, id: &str) -> Result<Vec<u8>, String> {
        let path = self.directory(id)?.join("image.png");
        if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() {
            return Err("Wallpaper links are unsupported".into());
        }
        fs::read(path).map_err(|e| e.to_string())
    }
    fn remove(&self, id: &str) -> Result<(), String> {
        // Keep immutable bytes valid for snapshots selected by another window during confirmation.
        let marker = self.directory(id)?.join("removed");
        match fs::OpenOptions::new().write(true).create_new(true).open(marker) {
            Ok(file) => file.sync_all().map_err(|e| e.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}
fn library<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<ImageLibrary, String> {
    Ok(ImageLibrary::new(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("wallpapers")))
}
fn check_window<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if !matches!(window.label(), "main" | "settings") {
        return Err("Wallpaper access is limited to main and settings windows".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn wallpaper_list(window: tauri::Window) -> Result<Vec<ImportedImage>, String> {
    check_window(&window)?;
    let library = library(window.app_handle())?;
    tauri::async_runtime::spawn_blocking(move || library.list()).await.map_err(|e| e.to_string())?
}
struct WallpaperDialogText {
    title: &'static str,
    import_title: &'static str,
    image_filter: &'static str,
    remove: &'static str,
    cancel: &'static str,
    chinese: bool,
}
impl WallpaperDialogText {
    fn for_locale(locale: Option<&str>) -> Self {
        if locale.is_some_and(|locale| locale.to_ascii_lowercase().starts_with("zh")) {
            Self {
                title: "壁纸",
                import_title: "导入壁纸",
                image_filter: "图片",
                remove: "移除",
                cancel: "取消",
                chinese: true,
            }
        } else {
            Self {
                title: "Wallpaper",
                import_title: "Import wallpaper",
                image_filter: "Images",
                remove: "Remove",
                cancel: "Cancel",
                chinese: false,
            }
        }
    }
    fn removal_message(&self, name: &str) -> String {
        if self.chinese {
            format!("从图库移除“{name}”？\n原文件和已保存副本会保留，不释放磁盘空间。")
        } else {
            format!(
                "Remove “{name}” from the library?\nThe original and saved copy will be kept. Disk space will not be reclaimed."
            )
        }
    }
}
#[tauri::command]
pub async fn wallpaper_import(window: tauri::Window, locale: Option<String>) -> Result<Option<ImportedImage>, String> {
    check_window(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let text = WallpaperDialogText::for_locale(locale.as_deref());
        let Some(selected) = app
            .dialog()
            .file()
            .set_title(text.import_title)
            .add_filter(text.image_filter, &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let name = path.file_name().ok_or("Image has no filename")?.to_string_lossy().to_string();
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .map_err(|e| e.to_string())?
            .take((MAX_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        library(&app)?.import_bytes(&name, &bytes).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn wallpaper_remove(window: tauri::Window, id: String, locale: Option<String>) -> Result<bool, String> {
    check_window(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let library = library(&app)?;
        let directory = library.directory(&id)?;
        let metadata: ImportedImage =
            serde_json::from_slice(&fs::read(directory.join("metadata.json")).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let text = WallpaperDialogText::for_locale(locale.as_deref());
        if !app
            .dialog()
            .message(text.removal_message(&metadata.name))
            .title(text.title)
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(text.remove.into(), text.cancel.into()))
            .blocking_show()
        {
            return Ok(false);
        }
        library.remove(&id)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("wallpaper-resources")
        .register_uri_scheme_protocol("wallpaper", |context, request| {
            let result = (|| -> Result<Vec<u8>, String> {
                if !matches!(context.webview_label(), "main" | "settings")
                    || request.method() != tauri::http::Method::GET
                {
                    return Err("Wallpaper resource request denied".into());
                }
                library(context.app_handle())?.read(request.uri().path().trim_start_matches('/'))
            })();
            match result {
                Ok(bytes) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", "image/png")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("X-Content-Type-Options", "nosniff")
                    .body(bytes)
                    .expect("valid image response"),
                Err(error) => tauri::http::Response::builder()
                    .status(403)
                    .header("Content-Type", "text/plain")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(error.into_bytes())
                    .expect("valid error response"),
            }
        })
        .build()
}
#[cfg(test)]
mod tests;
