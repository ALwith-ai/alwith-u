use std::io::{Read, Seek, Write};
use std::path::Path;

/// Codex rejects an empty Cursor MCP file rather than treating it as no servers.
/// Initialize only existing whitespace-only files; never rewrite real configuration.
fn initialize_empty_mcp(path: &Path) -> Result<(), String> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| format!("{}: {error}", path.display()))?;
    if !bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(());
    }
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    // Re-read after acquiring the writable handle so a newly populated file is preserved.
    bytes.clear();
    file.read_to_end(&mut bytes).map_err(|error| format!("{}: {error}", path.display()))?;
    if !bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(());
    }
    file.rewind()
        .and_then(|()| file.write_all(b"{}\n"))
        .and_then(|()| file.set_len(3))
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("{}: {error}", path.display()))
}

#[tauri3_specta::command]
pub async fn prepare_cursor_import(app: tauri::AppHandle, cwds: Vec<String>) -> Result<(), String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        initialize_empty_mcp(&home.join(".cursor/mcp.json"))?;
        for cwd in cwds {
            let cwd = Path::new(&cwd);
            if !cwd.is_absolute() {
                return Err("Import working directories must be absolute".to_string());
            }
            initialize_empty_mcp(&cwd.join(".cursor/mcp.json"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_only_existing_whitespace_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mcp.json");
        initialize_empty_mcp(&path).unwrap();
        assert!(!path.exists());
        for contents in ["", " \r\n\t "] {
            std::fs::write(&path, contents).unwrap();
            initialize_empty_mcp(&path).unwrap();
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
        }
        for contents in ["{\"mcpServers\":{}}", "{invalid", "\u{feff}", "null"] {
            std::fs::write(&path, contents).unwrap();
            initialize_empty_mcp(&path).unwrap();
            assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        }
    }
}
