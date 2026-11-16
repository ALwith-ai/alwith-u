//! Stage the verified NY CEF distribution without the bundler's stock CEF file list.
use std::{fs, io, path::Path};

const REQUIRED: &[&str] = &[
    "libcef.dll",
    "chrome_elf.dll",
    "d3dcompiler_47.dll",
    "dxcompiler.dll",
    "icudtl.dat",
    "resources.pak",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "v8_context_snapshot.bin",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
];

pub fn stage(source: &Path, destination: &Path) -> io::Result<()> {
    // Validate before replacing generated output. No user profile lives here.
    for name in REQUIRED.iter().copied().chain(["locales/en-US.pak"]) {
        if !source.join(name).is_file() {
            return Err(io::Error::new(io::ErrorKind::NotFound, format!("Missing NY CEF runtime file: {name}")));
        }
    }
    match fs::remove_dir_all(destination) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::create_dir_all(destination.join("locales"))?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file()
            && (path
                .extension()
                .is_some_and(|extension| matches!(extension.to_str(), Some("dll" | "bin" | "pak" | "dat" | "json")))
                || entry.file_name() == "CREDITS.html")
        {
            fs::copy(&path, destination.join(entry.file_name()))?;
        }
    }
    for entry in fs::read_dir(source.join("locales"))? {
        let entry = entry?;
        if entry.path().is_file() {
            fs::copy(entry.path(), destination.join("locales").join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_distribution_keeps_its_actual_runtime_files_and_locales_without_stock_dxil() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("sdk");
        fs::create_dir_all(source.join("locales")).unwrap();
        for name in REQUIRED.iter().copied().chain(["locales/en-US.pak", "locales/zh-CN.pak", "CREDITS.html"]) {
            fs::write(source.join(name), name).unwrap();
        }
        fs::write(source.join("libcef.lib"), "linker input").unwrap();
        let output = root.path().join("output");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("stale.dll"), "old SDK").unwrap();
        stage(&source, &output).unwrap();
        for name in REQUIRED.iter().copied().chain(["locales/en-US.pak", "locales/zh-CN.pak", "CREDITS.html"]) {
            assert_eq!(fs::read(output.join(name)).unwrap(), name.as_bytes());
        }
        assert!(!output.join("dxil.dll").exists());
        assert!(!output.join("libcef.lib").exists());
        assert!(!output.join("stale.dll").exists());
    }

    #[test]
    fn browser_distribution_rejects_an_incomplete_sdk_before_replacing_output() {
        let root = tempfile::tempdir().unwrap();
        let output = root.path().join("output");
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("libcef.dll"), "previous candidate").unwrap();
        let error = stage(&root.path().join("missing"), &output).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(fs::read(output.join("libcef.dll")).unwrap(), b"previous candidate");
    }
}
