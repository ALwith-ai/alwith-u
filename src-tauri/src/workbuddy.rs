use std::path::{Path, PathBuf};

use serde_json::Value;
#[cfg(not(debug_assertions))]
use tauri::Manager;

use alwith_api::process::HideConsoleExt;

fn destination(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if !parent.is_absolute() || !parent.is_dir() {
        return Err("Choose an existing parent directory".into());
    }
    if name.is_empty()
        || name.len() > 214
        || !name.as_bytes()[0].is_ascii_lowercase()
        || !name.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    {
        return Err("Use a lowercase package name containing letters, digits and hyphens".into());
    }
    let path = parent.canonicalize().map_err(|error| error.to_string())?.join(name);
    if path.exists() {
        return Err("The output directory already exists".into());
    }
    Ok(path)
}

fn generation_result(stdout: &[u8], expected: &Path) -> Result<String, String> {
    let text = std::str::from_utf8(stdout).map_err(|error| error.to_string())?;
    let result = text
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|value| value["type"] == "result")
        .ok_or("Generator returned no result")?;
    if result["ok"] != true {
        return Err(result["error"]["message"].as_str().unwrap_or("Project generation failed").to_owned());
    }
    let directory = result["directory"].as_str().ok_or("Generator returned no directory")?;
    if Path::new(directory) != expected {
        return Err("Generator returned an unexpected directory".into());
    }
    Ok(directory.to_owned())
}

#[tauri3_specta::command]
pub async fn workbuddy_create(
    app: tauri::AppHandle, parent: PathBuf, name: String, product_name: String, identifier: String, auth: String,
    github: Option<String>,
) -> Result<String, String> {
    if !["alwith", "none"].contains(&auth.as_str()) {
        return Err("Choose ALwith account or bare chat".into());
    }
    // The generator validates the repository and writes the updater key to ~/.tauri; blank means no updates.
    let github = github.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    let output_directory = destination(&parent, &name)?;
    #[cfg(debug_assertions)]
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    #[cfg(not(debug_assertions))]
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let _ = app;
    let entry = resources.join("create-alwith/src/cli.js");
    if !entry.is_file() {
        return Err("The bundled project generator is missing".into());
    }
    let mut command = tokio::process::Command::new(crate::runtime::sidecar_path("bun")?);
    command
        .arg("--no-install")
        .arg(entry)
        .arg(&output_directory)
        .args([
            "--name",
            &name,
            "--product-name",
            &product_name,
            "--identifier",
            &identifier,
            "--auth",
            &auth,
            "--preset",
            "chat",
            "--yes",
            "--json",
        ])
        .args(github.iter().flat_map(|repository| ["--github", repository.as_str()]))
        .kill_on_drop(true)
        .hide_console();
    let output = command.output().await.map_err(|error| error.to_string())?;
    let result = generation_result(&output.stdout, &output_directory)?;
    if !output.status.success() {
        return Err(format!("Project generator exited with {}", output.status));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_existing_directories_and_path_escape() {
        let root = tempfile::tempdir().unwrap();
        for name in ["../outside", "/absolute", "", "UPPER", "x/y"] {
            assert!(destination(root.path(), name).is_err());
        }
        let path = destination(root.path(), "my-app").unwrap();
        assert!(!path.exists());
        std::fs::create_dir(&path).unwrap();
        assert!(destination(root.path(), "my-app").is_err());
    }

    #[test]
    fn preserves_generator_errors_and_rejects_wrong_result_paths() {
        let expected = Path::new("/output/app");
        assert_eq!(
            generation_result(br#"{"type":"result","ok":false,"error":{"message":"Invalid identifier"}}"#, expected),
            Err("Invalid identifier".into())
        );
        assert!(generation_result(br#"{"type":"result","ok":true,"directory":"/elsewhere"}"#, expected).is_err());
        assert_eq!(generation_result(b"{\"type\":\"progress\",\"phase\":\"configure\"}\n{\"type\":\"result\",\"ok\":true,\"directory\":\"/output/app\"}", expected).unwrap(), "/output/app");
    }
}
