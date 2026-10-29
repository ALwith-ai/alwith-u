//! A CODEX_PATH proxy: serve U's prepared catalog for the adapter's exact lookup;
//! forward other invocations with U's supported interactive capabilities.
use std::ffi::{OsStr, OsString};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn catalog_request(args: &[OsString], catalog: Option<OsString>) -> Option<PathBuf> {
    if args == [OsStr::new("debug"), OsStr::new("models")] { catalog.map(PathBuf::from) } else { None }
}

fn write_catalog(path: &Path, output: &mut impl Write) -> io::Result<()> {
    let mut file = std::fs::File::open(path)?;
    io::copy(&mut file, output)?;
    output.flush()
}

fn app_server_catalog_arg(args: &[OsString], catalog: Option<OsString>) -> Option<OsString> {
    if args.first().is_none_or(|arg| arg != "app-server") {
        return None;
    }
    catalog.map(|path| {
        let path = path.to_str().expect("prepared catalog path must be UTF-8");
        let mut quoted = String::from("model_catalog_json=\"");
        for character in path.chars() {
            match character {
                '\\' | '"' => {
                    quoted.push('\\');
                    quoted.push(character);
                }
                c if c.is_control() => quoted.push_str(&format!("\\u{:04x}", c as u32)),
                c => quoted.push(c),
            }
        }
        quoted.push('"');
        OsString::from(quoted)
    })
}

#[cfg(not(test))]
fn main() {
    if let Err(error) = run() {
        eprintln!("alwith-codex-launcher: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(test))]
fn run() -> io::Result<()> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if let Some(path) = catalog_request(&args, std::env::var_os("ALWITH_U_CODEX_CATALOG")) {
        return write_catalog(&path, &mut io::stdout().lock());
    }
    let binary = std::env::var_os("ALWITH_U_CODEX_PATH")
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::other("ALWITH_U_CODEX_PATH is missing"))?;
    if !binary.is_absolute() || std::fs::canonicalize(&binary)? == std::fs::canonicalize(std::env::current_exe()?)? {
        return Err(io::Error::other("ALWITH_U_CODEX_PATH must name the original Codex executable"));
    }
    let mut command = std::process::Command::new(binary);
    // U renders ACP form elicitations in both collaboration modes. Enable Codex's
    // default-mode question tool for this process only, without editing user config.
    command.args(["--enable", "default_mode_request_user_input"]);
    // Suppress the experimental-feature banner only for U's Codex process.
    command.args(["-c", "suppress_unstable_features_warning=true"]);
    // ModelInfo is loaded at process startup, not from a thread's provider overrides.
    if let Some(catalog) = app_server_catalog_arg(&args, std::env::var_os("ALWITH_U_CODEX_CATALOG")) {
        command.arg("-c").arg(catalog);
    }
    command.args(args);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Replace this process: stdin, stdout, stderr, signals and exit status stay native.
        Err(command.exec())
    }
    #[cfg(windows)]
    {
        windows_job::contain_current_process()?;
        let status = command.status()?;
        std::process::exit(status.code().unwrap_or(1));
    }
}

#[cfg(all(windows, not(test)))]
mod windows_job {
    use std::ffi::c_void;
    use std::io;
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io_counters: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent_pid: u32,
        priority: i32,
        flags: u32,
        executable: [u16; 260],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
    }
    fn parent_handle() -> io::Result<Handle> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
            if snapshot == -1_isize as Handle {
                return Err(io::Error::last_os_error());
            }
            let mut entry: ProcessEntry = std::mem::zeroed();
            entry.size = size_of::<ProcessEntry>() as u32;
            let mut present = Process32FirstW(snapshot, &mut entry);
            let mut parent_pid = None;
            while present != 0 {
                if entry.pid == std::process::id() {
                    parent_pid = Some(entry.parent_pid);
                    break;
                }
                present = Process32NextW(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
            let pid = parent_pid.ok_or_else(|| io::Error::other("Cannot identify the launcher parent process"))?;
            let parent = OpenProcess(0x0010_0000, 0, pid); // SYNCHRONIZE
            if parent.is_null() {
                return Err(io::Error::last_os_error());
            }
            Ok(parent)
        }
    }

    pub fn contain_current_process() -> io::Result<()> {
        // The handle is deliberately process-owned, not inherited. Windows closes it on exit,
        // killing descendants even if Runtime terminates the proxy before Codex exits.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if SetInformationJobObject(
                job,
                9,
                (&limits as *const ExtendedLimits).cast(),
                size_of::<ExtendedLimits>() as u32,
            ) == 0
                || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
            {
                let error = io::Error::last_os_error();
                CloseHandle(job);
                return Err(error);
            }
        }
        // The adapter launches CODEX_PATH through cmd.exe and may terminate that shell.
        // Observe the shell handle so its death also closes our job, even if Codex ignores EOF.
        let parent = parent_handle()? as usize;
        std::thread::Builder::new().name("codex-parent-watch".into()).spawn(move || unsafe {
            let parent = parent as Handle;
            let result = WaitForSingleObject(parent, u32::MAX);
            let error = io::Error::last_os_error();
            CloseHandle(parent);
            if result != 0 {
                eprintln!("alwith-codex-launcher: parent wait failed: {error}");
            }
            std::process::exit(1);
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_metadata_reaches_the_app_server_at_startup_only() {
        let path = OsString::from("/private cache/目录.json");
        let args = |values: &[&str]| values.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(
            app_server_catalog_arg(&args(&["app-server"]), Some(path.clone())),
            Some(OsString::from("model_catalog_json=\"/private cache/目录.json\""))
        );
        assert_eq!(app_server_catalog_arg(&args(&["--version"]), Some(path)), None);
        assert_eq!(app_server_catalog_arg(&args(&["app-server"]), None), None);
    }
    #[test]
    fn catalog_paths_escape_windows_separators_quotes_and_control_characters() {
        for (path, expected) in [
            (r#"C:\Users\A "B"\models.json"#, r#"model_catalog_json="C:\\Users\\A \"B\"\\models.json""#),
            ("/tmp/\n\t\u{0001}.json", r#"model_catalog_json="/tmp/\u000a\u0009\u0001.json""#),
        ] {
            assert_eq!(
                app_server_catalog_arg(&[OsString::from("app-server")], Some(OsString::from(path))),
                Some(OsString::from(expected))
            );
        }
    }
    #[test]
    fn only_the_exact_catalog_lookup_is_intercepted() {
        let path = OsString::from("/private cache/目录.json");
        let args = |values: &[&str]| values.iter().map(OsString::from).collect::<Vec<_>>();
        assert_eq!(catalog_request(&args(&["debug", "models"]), Some(path.clone())), Some(PathBuf::from(&path)));
        for values in [
            vec!["--version"],
            vec!["debug", "models", "--bundled"],
            vec!["-c", "model_catalog_json='a b'", "app-server"],
        ] {
            assert_eq!(catalog_request(&args(&values), Some(path.clone())), None);
        }
        assert_eq!(catalog_request(&args(&["debug", "models"]), None), None);
    }
    #[test]
    fn snapshot_bytes_and_read_errors_are_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("目录.json");
        let bytes = br#"{"models":[{"slug":"native"}]}"#;
        std::fs::write(&path, bytes).unwrap();
        let mut output = Vec::new();
        write_catalog(&path, &mut output).unwrap();
        assert_eq!(output, bytes);
        assert!(write_catalog(&directory.path().join("missing"), &mut output).is_err());
    }
}
