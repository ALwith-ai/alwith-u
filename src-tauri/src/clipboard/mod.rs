//! Clipboard history: what was copied, kept on this computer only.
//!
//! Off until the user turns it on (`clipboard.enabled`). Content another application marks as
//! concealed or transient, such as a password manager's, is never recorded.
pub mod store;

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, AtomicU64, Ordering},
};
use store::{Capture, Item, Kind, Store};
use tauri::{Emitter, Manager};

/// Sent to every window after the history changed.
const CHANGED: &str = "clipboard:changed";
/// The longest edge of the picture a list row shows.
const THUMBNAIL: u32 = 256;

#[derive(Default)]
struct Shared {
    /// Open exactly while the history is on.
    store: Mutex<Option<Store>>,
    /// Bumped whenever the history is turned on or off; a watcher of an older generation stops.
    generation: AtomicU64,
    /// The system change count of our own latest write, which is not a copy to record.
    written: AtomicI64,
}

#[derive(Clone, Default)]
pub struct Clipboard(Arc<Shared>);

fn now() -> i64 {
    let elapsed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("clock is after the epoch");
    i64::try_from(elapsed.as_millis()).expect("milliseconds since the epoch fit in i64")
}

impl Clipboard {
    fn with<T>(&self, run: impl FnOnce(&mut Store) -> Result<T, String>) -> Result<T, String> {
        let mut store = self.0.store.lock().map_err(|_| "Clipboard history lock is poisoned")?;
        run(store.as_mut().ok_or("Clipboard history is off")?)
    }

    /// Follows the `clipboard.enabled` setting. Turning the history off stops recording and closes
    /// the database; what was recorded stays on disk.
    pub fn set_enabled(&self, app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
        let mut store = self.0.store.lock().map_err(|_| "Clipboard history lock is poisoned")?;
        if enabled == store.is_some() {
            return Ok(());
        }
        let generation = self.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if !enabled {
            *store = None;
            return Ok(());
        }
        if !system::SUPPORTED {
            return Err("Clipboard history is not available on this platform".into());
        }
        let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("clipboard");
        let mut opened = Store::open(&directory)?;
        opened.prune(now())?;
        *store = Some(opened);
        let (shared, app) = (self.0.clone(), app.clone());
        std::thread::Builder::new()
            .name("clipboard-history".into())
            .spawn(move || watch(&shared, &app, generation))
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// macOS announces no clipboard change: the change count is the only signal there is, so it is read
/// twice a second, the interval other clipboard managers use.
fn watch(shared: &Shared, app: &tauri::AppHandle, generation: u64) {
    // What is on the clipboard when the history is turned on was copied before consent.
    let mut seen = system::change_count();
    while shared.generation.load(Ordering::SeqCst) == generation {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let count = system::change_count();
        if count == seen {
            continue;
        }
        seen = count;
        if count == shared.written.load(Ordering::SeqCst) || system::concealed() {
            continue;
        }
        let recorded = system::read().and_then(|capture| {
            let Some(capture) = capture else { return Ok(false) };
            let mut store = shared.store.lock().map_err(|_| "Clipboard history lock is poisoned")?;
            // Turned off while this copy was being read.
            let Some(store) = store.as_mut() else { return Ok(false) };
            store.record(&capture, now()).map(|_| true)
        });
        match recorded {
            Ok(true) => {
                if let Err(error) = app.emit(CHANGED, ()) {
                    log::error!("Could not announce a clipboard change: {error}");
                }
            }
            Ok(false) => {}
            // One unreadable copy must not end the history.
            Err(error) => log::error!("Could not record the clipboard: {error}"),
        }
    }
}

/// Whether this platform can keep a clipboard history at all.
#[tauri3_specta::command]
pub fn clipboard_supported() -> bool {
    system::SUPPORTED
}

/// Pinned entries, then the newest; a query keeps the entries whose text contains it.
#[tauri3_specta::command]
pub fn clipboard_list(clipboard: tauri::State<'_, Clipboard>, query: String, limit: u32) -> Result<Vec<Item>, String> {
    clipboard.with(|store| store.list(&query, limit))
}

/// A picture small enough for a list row, as a `data:` URL.
#[tauri3_specta::command]
pub async fn clipboard_thumbnail(clipboard: tauri::State<'_, Clipboard>, id: f64) -> Result<String, String> {
    use base64::Engine;
    let item = clipboard.with(|store| store.get(id as i64))?.ok_or("No such clipboard entry")?;
    let path = item.image.ok_or("The clipboard entry is not an image")?;
    let picture = image::open(&path).map_err(|error| error.to_string())?.thumbnail(THUMBNAIL, THUMBNAIL);
    let mut png = std::io::Cursor::new(Vec::new());
    picture.write_to(&mut png, image::ImageFormat::Png).map_err(|error| error.to_string())?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png.into_inner())))
}

/// Puts an entry back on the system clipboard and moves it to the front of the history.
#[tauri3_specta::command]
pub fn clipboard_copy(app: tauri::AppHandle, clipboard: tauri::State<'_, Clipboard>, id: f64) -> Result<(), String> {
    let shared = clipboard.0.clone();
    clipboard.with(|store| {
        let item = store.get(id as i64)?.ok_or("No such clipboard entry")?;
        let capture = match item.kind {
            Kind::Text => Capture::Text(item.text),
            Kind::Files => Capture::Files(item.text.lines().map(str::to_owned).collect()),
            Kind::Image => Capture::Image(
                std::fs::read(item.image.ok_or("The image entry has no file")?).map_err(|e| e.to_string())?,
            ),
        };
        system::write(&capture)?;
        shared.written.store(system::change_count(), Ordering::SeqCst);
        store.record(&capture, now()).map(|_| ())
    })?;
    app.emit(CHANGED, ()).map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub fn clipboard_pin(
    app: tauri::AppHandle, clipboard: tauri::State<'_, Clipboard>, id: f64, pinned: bool,
) -> Result<(), String> {
    clipboard.with(|store| store.pin(id as i64, pinned, now()))?;
    app.emit(CHANGED, ()).map_err(|error| error.to_string())
}

#[tauri3_specta::command]
pub fn clipboard_remove(app: tauri::AppHandle, clipboard: tauri::State<'_, Clipboard>, id: f64) -> Result<(), String> {
    clipboard.with(|store| store.remove(id as i64))?;
    app.emit(CHANGED, ()).map_err(|error| error.to_string())
}

/// Drops every entry that is not pinned.
#[tauri3_specta::command]
pub fn clipboard_clear(app: tauri::AppHandle, clipboard: tauri::State<'_, Clipboard>) -> Result<(), String> {
    clipboard.with(Store::clear)?;
    app.emit(CHANGED, ()).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
mod system {
    use super::Capture;
    use objc2_app_kit::NSPasteboard;

    pub const SUPPORTED: bool = true;

    /// Markers by which an application asks clipboard managers not to keep what it copied
    /// (nspasteboard.org).
    const WITHHELD: [&str; 3] =
        ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType", "org.nspasteboard.AutoGeneratedType"];

    pub fn change_count() -> i64 {
        NSPasteboard::generalPasteboard().changeCount() as i64
    }

    pub fn concealed() -> bool {
        NSPasteboard::generalPasteboard()
            .types()
            .is_some_and(|types| types.iter().any(|kind| WITHHELD.contains(&kind.to_string().as_str())))
    }

    fn available<T>(read: Result<T, arboard::Error>) -> Result<Option<T>, String> {
        match read {
            Ok(value) => Ok(Some(value)),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    /// Files are read before text: Finder puts a copied file's display name beside its URL, and a
    /// text-first read would record `IMG_1234.png` as prose.
    pub fn read() -> Result<Option<Capture>, String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
        if let Some(files) = available(clipboard.get().file_list())?
            && !files.is_empty()
        {
            return Ok(Some(Capture::Files(files.iter().map(|path| path.to_string_lossy().into_owned()).collect())));
        }
        if let Some(text) = available(clipboard.get_text())?
            && !text.trim().is_empty()
        {
            return Ok(Some(Capture::Text(text)));
        }
        let Some(picture) = available(clipboard.get_image())? else { return Ok(None) };
        let (width, height) = (picture.width as u32, picture.height as u32);
        let pixels = image::RgbaImage::from_raw(width, height, picture.bytes.into_owned())
            .ok_or("The clipboard image does not match its dimensions")?;
        let mut png = std::io::Cursor::new(Vec::new());
        pixels.write_to(&mut png, image::ImageFormat::Png).map_err(|error| error.to_string())?;
        Ok(Some(Capture::Image(png.into_inner())))
    }

    pub fn write(capture: &Capture) -> Result<(), String> {
        let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
        match capture {
            Capture::Text(text) => clipboard.set_text(text.as_str()),
            Capture::Files(paths) => clipboard.set().file_list(paths),
            Capture::Image(png) => {
                let pixels = image::load_from_memory(png).map_err(|error| error.to_string())?.into_rgba8();
                let (width, height) = (pixels.width() as usize, pixels.height() as usize);
                clipboard.set_image(arboard::ImageData { width, height, bytes: pixels.into_raw().into() })
            }
        }
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod system {
    use super::Capture;

    pub const SUPPORTED: bool = false;
    const UNSUPPORTED: &str = "Clipboard history is not available on this platform";

    pub fn change_count() -> i64 {
        unreachable!("{UNSUPPORTED}")
    }
    pub fn concealed() -> bool {
        unreachable!("{UNSUPPORTED}")
    }
    pub fn read() -> Result<Option<Capture>, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn write(_capture: &Capture) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}
