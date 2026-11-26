//! The clipboard history on disk: rows in SQLite beside the image files they own.
//!
//! A history is captured rather than authored, so nothing else can put it back: it lives in the
//! application data directory, never in a cache.
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Unpinned entries older than this are dropped.
pub const RETENTION_MILLISECONDS: i64 = 90 * 24 * 60 * 60 * 1000;

/// What was on the clipboard, as capture tells the kinds apart.
#[derive(Clone, Debug, PartialEq)]
pub enum Capture {
    Text(String),
    /// Encoded PNG.
    Image(Vec<u8>),
    /// Absolute paths, referenced where they lie and never copied.
    Files(Vec<String>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Image,
    Files,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::Files => "files",
        }
    }
    fn named(name: &str) -> rusqlite::Result<Self> {
        match name {
            "text" => Ok(Self::Text),
            "image" => Ok(Self::Image),
            "files" => Ok(Self::Files),
            other => Err(rusqlite::Error::InvalidColumnName(other.to_owned())),
        }
    }
}

/// One entry of the history.
#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[specta(type = f64)]
    pub id: i64,
    pub kind: Kind,
    /// The text; for files, their paths one per line; empty for an image.
    pub text: String,
    /// The image file an image entry owns.
    pub image: Option<String>,
    /// Milliseconds since the epoch.
    #[specta(type = f64)]
    pub copied_at: i64,
    pub pinned: bool,
}

pub struct Store {
    connection: Connection,
    images: PathBuf,
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get(0)?,
        kind: Kind::named(&row.get::<_, String>(1)?)?,
        text: row.get(2)?,
        image: row.get(3)?,
        copied_at: row.get(4)?,
        pinned: row.get::<_, Option<i64>>(5)?.is_some(),
    })
}

const COLUMNS: &str = "id, kind, text, image, copied_at, pinned_at";

impl Store {
    pub fn open(directory: &Path) -> Result<Self, String> {
        let images = directory.join("images");
        std::fs::create_dir_all(&images).map_err(|error| error.to_string())?;
        let connection = Connection::open(directory.join("clipboard.sqlite3")).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS items (
                     id INTEGER PRIMARY KEY,
                     kind TEXT NOT NULL,
                     text TEXT NOT NULL,
                     image TEXT,
                     hash BLOB NOT NULL UNIQUE,
                     copied_at INTEGER NOT NULL,
                     pinned_at INTEGER
                 );
                 CREATE INDEX IF NOT EXISTS items_copied_at ON items (copied_at);",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self { connection, images })
    }

    /// Records a capture as the newest entry. Content already in the history moves to the front
    /// instead of being stored twice, and keeps its pin.
    pub fn record(&mut self, capture: &Capture, now: i64) -> Result<Item, String> {
        let (kind, text, bytes): (Kind, String, &[u8]) = match capture {
            Capture::Text(text) => (Kind::Text, text.clone(), text.as_bytes()),
            Capture::Image(png) => (Kind::Image, String::new(), png),
            Capture::Files(paths) => (Kind::Files, paths.join("\n"), &[]),
        };
        let mut hasher = Sha256::new();
        hasher.update(kind.name().as_bytes());
        hasher.update([0]);
        hasher.update(if bytes.is_empty() { text.as_bytes() } else { bytes });
        let hash = hasher.finalize().to_vec();
        let known: Option<i64> = self
            .connection
            .query_row("SELECT id FROM items WHERE hash = ?1", params![hash], |row| row.get(0))
            .optional()
            .map_err(|error| error.to_string())?;
        let id = if let Some(id) = known {
            self.connection
                .execute("UPDATE items SET copied_at = ?1 WHERE id = ?2", params![now, id])
                .map_err(|error| error.to_string())?;
            id
        } else {
            let image = if let Capture::Image(png) = capture {
                let name: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
                let path = self.images.join(format!("{name}.png"));
                std::fs::write(&path, png).map_err(|error| error.to_string())?;
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            };
            self.connection
                .execute(
                    "INSERT INTO items (kind, text, image, hash, copied_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![kind.name(), text, image, hash, now],
                )
                .map_err(|error| error.to_string())?;
            self.connection.last_insert_rowid()
        };
        self.get(id)?.ok_or_else(|| "The recorded clipboard entry is missing".into())
    }

    pub fn get(&self, id: i64) -> Result<Option<Item>, String> {
        self.connection
            .query_row(&format!("SELECT {COLUMNS} FROM items WHERE id = ?1"), params![id], row)
            .optional()
            .map_err(|error| error.to_string())
    }

    /// Pinned entries first, then the newest; `query` keeps the entries whose text contains it.
    pub fn list(&self, query: &str, limit: u32) -> Result<Vec<Item>, String> {
        // LIKE's own wildcards are matched literally.
        let pattern = format!("%{}%", query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut statement = self
            .connection
            .prepare_cached(&format!(
                "SELECT {COLUMNS} FROM items WHERE ?1 = '%%' OR text LIKE ?1 ESCAPE '\\'
                 ORDER BY pinned_at IS NULL, copied_at DESC, id DESC LIMIT ?2"
            ))
            .map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![pattern, limit], row).map_err(|error| error.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|error| error.to_string())
    }

    pub fn pin(&mut self, id: i64, pinned: bool, now: i64) -> Result<(), String> {
        let changed = self
            .connection
            .execute("UPDATE items SET pinned_at = ?1 WHERE id = ?2", params![pinned.then_some(now), id])
            .map_err(|error| error.to_string())?;
        if changed == 1 { Ok(()) } else { Err(format!("No clipboard entry {id}")) }
    }

    pub fn remove(&mut self, id: i64) -> Result<(), String> {
        self.delete("id = ?1", params![id])
    }

    /// Drops every entry that is not pinned.
    pub fn clear(&mut self) -> Result<(), String> {
        self.delete("pinned_at IS NULL", params![])
    }

    /// Drops unpinned entries last copied before the retention window.
    pub fn prune(&mut self, now: i64) -> Result<(), String> {
        self.delete("pinned_at IS NULL AND copied_at < ?1", params![now - RETENTION_MILLISECONDS])
    }

    /// Deletes rows, then the image files they owned; a file whose row survives is never touched.
    fn delete(&mut self, condition: &str, values: impl rusqlite::Params) -> Result<(), String> {
        let transaction = self.connection.transaction().map_err(|error| error.to_string())?;
        let images: Vec<String> = {
            let mut statement = transaction
                .prepare(&format!("DELETE FROM items WHERE {condition} RETURNING image"))
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map(values, |row| row.get::<_, Option<String>>(0))
                .map_err(|error| error.to_string())?;
            rows.filter_map(Result::transpose).collect::<Result<_, _>>().map_err(|error| error.to_string())?
        };
        transaction.commit().map_err(|error| error.to_string())?;
        for image in images {
            match std::fs::remove_file(&image) {
                Ok(()) => {}
                // The row is gone either way; a file removed by hand is not an error.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("Could not delete {image}: {error}")),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "../__tests__/clipboard_store.rs"]
mod tests;
