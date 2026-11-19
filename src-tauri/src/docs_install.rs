use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::Path,
};
use tauri::Manager;

const FILES: [&str; 3] = ["SKILL.md", "agents/openai.yaml", "references/manual.md"];
const MARKER: &str = ".alwith-docs.json";

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    #[cfg(not(debug_assertions))]
    let resources = app.path().resource_dir()?;
    let home = crate::codex_home::resolve(app)?;
    sync(
        &resources.join("adapter/alwith-docs"),
        &home.join("skills/alwith-docs"),
        &app.path().app_data_dir()?.join("docs-install.json"),
    )?;
    Ok(())
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().expect("installation files have a parent");
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn sync(source: &Path, target: &Path, receipt: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let contents = FILES.iter().map(|name| fs::read(source.join(name))).collect::<io::Result<Vec<_>>>()?;
    let hashes = FILES
        .iter()
        .zip(&contents)
        .map(|(name, bytes)| (name.to_string(), json!(hash(bytes))))
        .collect::<serde_json::Map<String, Value>>();
    let revision = serde_json::to_vec(&json!({"target": target, "hashes": hashes}))?;
    if read_optional(receipt)?.as_deref() == Some(revision.as_slice()) {
        return Ok(());
    }
    let managed = match fs::symlink_metadata(target) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => true,
        Err(error) => return Err(error.into()),
        Ok(metadata) if metadata.file_type().is_symlink() => false,
        Ok(_) => match read_optional(&target.join(MARKER))? {
            None => false,
            Some(bytes) => {
                let saved: Value = serde_json::from_slice(&bytes)?;
                let mut intact = saved["owner"] == "alwith-u";
                for name in ["agents", "references", "SKILL.md", "agents/openai.yaml", "references/manual.md"] {
                    match fs::symlink_metadata(target.join(name)) {
                        Ok(metadata) => intact &= !metadata.file_type().is_symlink(),
                        Err(error) if error.kind() == io::ErrorKind::NotFound => intact = false,
                        Err(error) => return Err(error.into()),
                    }
                }
                if intact {
                    for name in FILES {
                        intact &= saved["hashes"][name] == hash(&fs::read(target.join(name))?);
                    }
                }
                intact
            }
        },
    };
    if managed {
        // Build the whole skill beside the target and swap directories: an interrupted update leaves the
        // old skill, the new one or none, never a mixture that the next start would take for a user edit.
        let parent = target.parent().expect("the skill directory has a parent");
        fs::create_dir_all(parent)?;
        let staging = tempfile::Builder::new().prefix(".alwith-docs-").tempdir_in(parent)?;
        let next = staging.path().join("next");
        for (name, bytes) in FILES.iter().zip(&contents) {
            atomic_write(&next.join(name), bytes)?;
        }
        atomic_write(&next.join(MARKER), &serde_json::to_vec(&json!({"owner": "alwith-u", "hashes": hashes}))?)?;
        match fs::rename(target, staging.path().join("previous")) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        fs::rename(&next, target)?;
    } else {
        log::info!("Preserved an existing or user-edited alwith-docs skill");
    }
    atomic_write(receipt, &revision)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrades_preserve_user_edits_and_completed_versions() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("skill");
        let receipt = temp.path().join("receipt.json");
        for name in FILES {
            atomic_write(&source.join(name), b"v1").unwrap();
        }
        sync(&source, &target, &receipt).unwrap();
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), b"v1");
        for name in FILES {
            atomic_write(&source.join(name), b"v2").unwrap();
        }
        sync(&source, &target, &receipt).unwrap();
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), b"v2");
        atomic_write(&target.join("SKILL.md"), b"user").unwrap();
        for name in FILES {
            atomic_write(&source.join(name), b"v3").unwrap();
        }
        sync(&source, &target, &receipt).unwrap();
        assert_eq!(fs::read(target.join("SKILL.md")).unwrap(), b"user");
        fs::remove_dir_all(&target).unwrap();
        sync(&source, &target, &receipt).unwrap();
        assert!(!target.exists());
    }

    #[test]
    fn an_update_replaces_the_whole_skill_and_leaves_nothing_beside_it() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("skills/alwith-docs");
        let receipt = temp.path().join("receipt.json");
        for name in FILES {
            atomic_write(&source.join(name), b"v1").unwrap();
        }
        sync(&source, &target, &receipt).unwrap();
        // A file of the installed version that the next version no longer ships must not survive.
        atomic_write(&target.join("references/stale.md"), b"v1").unwrap();
        for name in FILES {
            atomic_write(&source.join(name), b"v2").unwrap();
        }
        sync(&source, &target, &receipt).unwrap();
        for name in FILES {
            assert_eq!(fs::read(target.join(name)).unwrap(), b"v2");
        }
        assert!(!target.join("references/stale.md").exists());
        let siblings: Vec<_> =
            fs::read_dir(target.parent().unwrap()).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(siblings, ["alwith-docs"]);
    }
}
