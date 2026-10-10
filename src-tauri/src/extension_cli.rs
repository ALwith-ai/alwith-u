//! Desktop command-line client; the GUI remains the sole owner of extension storage.
use crate::extension_control::{
    Frame, InstallRequest, Outcome, UninstallRequest, WireRequest, read_frame, valid_extension_id, write_frame,
};
use crate::extension_transport::{DeadlineReader, Stream, connect, remaining};
use std::{
    io::{BufReader, Write},
    path::PathBuf,
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, Instant},
};

enum Command {
    Install { path: PathBuf, enable: bool, update: bool },
    Uninstall { id: String, purge: bool },
    Result { request_id: String },
    Help,
}
struct Parsed {
    command: Command,
    timeout: Duration,
    json: bool,
}

const HELP: &str = "Usage (macOS / Windows):\n  alwith-u extension install --path DIRECTORY [--enable] [--update] [--json] [--timeout SECONDS]\n  alwith-u extension uninstall --id ID [--purge] [--json] [--timeout SECONDS]\n  alwith-u extension result --request-id UUID [--json] [--timeout SECONDS]\n\nInstall and uninstall wait for completion. A timeout does not cancel an accepted request.\n";

fn parse(args: &[&str]) -> Result<Parsed, String> {
    if args.first() != Some(&"extension") {
        return Err(HELP.into());
    }
    if args.get(1).is_some_and(|arg| matches!(*arg, "--help" | "help")) {
        return Ok(Parsed { command: Command::Help, timeout: Duration::from_secs(120), json: false });
    }
    let operation = args.get(1).ok_or(HELP)?;
    let mut path = None;
    let mut extension_id = None;
    let mut purge = false;
    let mut request_id = None;
    let mut enable = false;
    let mut update = false;
    let mut json = false;
    let mut timeout = 120;
    let mut index = 2;
    while let Some(arg) = args.get(index) {
        match *arg {
            "--path" | "--id" | "--request-id" | "--timeout" => {
                let value = *args.get(index + 1).ok_or_else(|| format!("Missing value for {arg}"))?;
                if value.starts_with("--") {
                    return Err(format!("Missing value for {arg}"));
                }
                match *arg {
                    "--path" if path.is_none() => path = Some(PathBuf::from(value)),
                    "--id" if extension_id.is_none() => {
                        if !valid_extension_id(value) {
                            return Err("Invalid extension ID".into());
                        }
                        extension_id = Some(value.into());
                    }
                    "--request-id" if request_id.is_none() => {
                        uuid::Uuid::parse_str(value).map_err(|_| "Invalid request ID")?;
                        request_id = Some(value.into());
                    }
                    "--timeout" => {
                        timeout = value.parse::<u64>().map_err(|_| "Timeout must be an integer")?;
                        if !(1..=3600).contains(&timeout) {
                            return Err("Timeout must be between 1 and 3600 seconds".into());
                        }
                    }
                    _ => return Err(format!("Duplicate argument {arg}")),
                }
                index += 1;
            }
            "--purge" if !purge => purge = true,
            "--enable" if !enable => enable = true,
            "--update" if !update => update = true,
            "--json" if !json => json = true,
            _ => return Err(format!("Unknown or duplicate argument: {arg}\n{HELP}")),
        }
        index += 1;
    }
    let command = match *operation {
        "install" if request_id.is_none() && extension_id.is_none() && !purge => {
            Command::Install { path: path.ok_or("--path is required")?, enable, update }
        }
        "uninstall" if path.is_none() && request_id.is_none() && !enable && !update => {
            Command::Uninstall { id: extension_id.ok_or("--id is required")?, purge }
        }
        "result" if path.is_none() && extension_id.is_none() && !purge && !enable && !update => {
            Command::Result { request_id: request_id.ok_or("--request-id is required")? }
        }
        _ => return Err(HELP.into()),
    };
    Ok(Parsed { command, timeout: Duration::from_secs(timeout), json })
}

fn execute(parsed: &Parsed, identifier: &str) -> Outcome {
    let id = match &parsed.command {
        Command::Result { request_id } => request_id.clone(),
        _ => uuid::Uuid::new_v4().to_string(),
    };
    let request = match &parsed.command {
        Command::Install { path, enable, update } => {
            let canonical = match path.canonicalize() {
                Ok(path) if path.is_dir() => path,
                _ => return Outcome::failure(&id, 2, "invalidPath", "--path must identify an existing directory"),
            };
            let Some(path) = canonical.to_str() else {
                return Outcome::failure(&id, 2, "invalidPath", "Directory path must be UTF-8");
            };
            WireRequest::Install {
                protocol_version: 1,
                request: InstallRequest { request_id: id.clone(), path: path.into(), enable: *enable, update: *update },
            }
        }
        Command::Uninstall { id: extension_id, purge } => WireRequest::Uninstall {
            protocol_version: 1,
            request: UninstallRequest { request_id: id.clone(), id: extension_id.clone(), purge: *purge },
        },
        Command::Result { .. } => WireRequest::Result { protocol_version: 1, request_id: id.clone() },
        Command::Help => return Outcome::failure(&id, 2, "invalidCommand", HELP),
    };
    let deadline = Instant::now() + parsed.timeout;
    let mut launched = false;
    let mut stream = loop {
        match connect(identifier) {
            Ok(stream) => break stream,
            Err(error) => {
                if Instant::now() >= deadline {
                    return Outcome::failure(&id, 3, "connectFailed", &error);
                }
                if !launched {
                    let launch = std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| {
                        let mut command = ProcessCommand::new(exe);
                        #[cfg(windows)]
                        {
                            use std::os::windows::process::CommandExt;
                            command.creation_flags(windows_sys::Win32::System::Threading::DETACHED_PROCESS);
                        }
                        command
                            .arg("--extension-control-launch")
                            .stdin(Stdio::null())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .spawn()
                            .map_err(|e| e.to_string())
                    });
                    if let Err(error) = launch {
                        return Outcome::failure(&id, 3, "launchFailed", &error);
                    }
                    launched = true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    };
    if let Err(error) = remaining(deadline).and_then(|timeout| stream.set_write_timeout(Some(timeout))) {
        return Outcome::failure(&id, 3, "connectFailed", &error.to_string());
    }
    if let Err(error) = write_frame(&mut stream, &request) {
        return Outcome::failure(&id, 3, "sendFailed", &error);
    }
    receive_result(stream, &id, deadline)
}

fn receive_result(stream: Stream, id: &str, deadline: Instant) -> Outcome {
    let reader = match DeadlineReader::new(stream, deadline) {
        Ok(reader) => reader,
        Err(error) => return Outcome::failure(id, 6, "resultUnknown", &error.to_string()),
    };
    let mut reader = BufReader::new(reader);
    let mut accepted = false;
    loop {
        let frame =
            remaining(deadline).map_err(|error| error.to_string()).and_then(|_| read_frame::<Frame>(&mut reader));
        match frame {
            Ok(Frame::Accepted { request_id }) if request_id == id => {
                accepted = true;
                eprintln!("Extension request accepted: {id}")
            }
            Ok(Frame::Result { result }) if result.request_id == id => return result,
            Ok(Frame::Error { message }) => {
                return Outcome::failure(
                    id,
                    if accepted { 6 } else { 4 },
                    if accepted { "resultUnknown" } else { "requestFailed" },
                    &message,
                );
            }
            Ok(_) => {
                return Outcome::failure(
                    id,
                    6,
                    "resultUnknown",
                    "Response identity mismatch; query the request result",
                );
            }
            Err(error) => {
                return Outcome::failure(
                    id,
                    6,
                    "resultUnknown",
                    &format!("{error}; extension operation may still be running. Query request {id} before retrying"),
                );
            }
        }
    }
}

pub(crate) fn run(args: &[String], identifier: &str) -> i32 {
    let parsed = match parse(&args.iter().map(String::as_str).collect::<Vec<_>>()) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("{message}");
            return 2;
        }
    };
    if matches!(parsed.command, Command::Help) {
        print!("{HELP}");
        return 0;
    }
    let outcome = execute(&parsed, identifier);
    let output = if parsed.json {
        serde_json::to_string(&outcome)
    } else {
        Ok(match &outcome.error {
            Some(error) => format!("{}: {} (request {})", error.code, error.message, outcome.request_id),
            None if outcome.data_purged.is_some() => format!(
                "Uninstalled {} (data {}, request {})",
                outcome.id.as_deref().unwrap_or("unknown"),
                if outcome.data_purged == Some(true) { "purged" } else { "retained" },
                outcome.request_id
            ),
            None => format!(
                "Installed {} {} (request {})",
                outcome.id.as_deref().unwrap_or("unknown"),
                outcome.version.as_deref().unwrap_or("unknown"),
                outcome.request_id
            ),
        })
    };
    match output {
        Ok(output) => {
            if let Err(error) = writeln!(std::io::stdout(), "{output}") {
                eprintln!("Cannot write install result: {error}");
                return 3;
            }
        }
        Err(error) => {
            eprintln!("Cannot serialize install result: {error}");
            return 3;
        }
    }
    outcome.exit_code
}

#[cfg(test)]
#[path = "__tests__/extension_cli.rs"]
mod tests;
