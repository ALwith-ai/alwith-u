//! Bounded native log snapshots for the single diagnostic export.
use regex::{Captures, Regex};
use serde::Serialize;
use std::{
    fs,
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::OnceLock,
};

const APPLICATION_BYTES: u64 = 2 * 1024 * 1024;
const PANIC_BYTES: u64 = 1024 * 1024;
const ROTATED_BYTES: u64 = 512 * 1024;
const TOTAL_BYTES: u64 = 4 * 1024 * 1024;
const COMPUTER_BYTES: u64 = 64 * 1024;
const ROTATED_COUNT: usize = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeLogs {
    max_total_bytes: u64,
    directory_error_kind: Option<String>,
    omitted_files: usize,
    files: Vec<LogFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogFile {
    name: String,
    archive_path: Option<String>,
    original_bytes: Option<u64>,
    max_bytes: u64,
    truncated: bool,
    read_error_kind: Option<String>,
    #[serde(skip_serializing)]
    content: String,
}

impl NativeLogs {
    pub(super) fn add_computer(&mut self, snapshot: Result<String, String>) {
        let name = "computer.log";
        let (snapshot, error) = match snapshot {
            Ok(snapshot) => (snapshot, None),
            Err(error) => (format!("Computer diagnostics unavailable: {error}\n"), Some("Unavailable".into())),
        };
        let original_bytes = snapshot.len() as u64;
        // Native diagnostics use a bounded byte ring; its first line may have lost a credential label.
        let cropped = original_bytes >= 16 * 1024;
        let snapshot = if cropped { snapshot.split_once('\n').map_or("", |(_, tail)| tail) } else { &snapshot };
        let mut content = redact(snapshot);
        let mut truncated = cropped;
        if content.len() as u64 > COMPUTER_BYTES {
            let start = content.len() - COMPUTER_BYTES as usize;
            content = content.as_bytes()[start..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(String::new(), |index| content[start + index + 1..].into());
            truncated = true;
        }
        self.files.push(LogFile {
            name: name.into(),
            archive_path: Some(format!("logs/{name}")),
            original_bytes: Some(original_bytes),
            max_bytes: COMPUTER_BYTES,
            truncated,
            read_error_kind: error,
            content,
        });
    }
    pub(super) fn write_archive<W: io::Write + io::Seek>(
        &self, archive: &mut zip::ZipWriter<W>,
    ) -> zip::result::ZipResult<()> {
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for file in &self.files {
            if let Some(path) = &file.archive_path {
                archive.start_file(path, options)?;
                archive.write_all(file.content.as_bytes())?;
            }
        }
        Ok(())
    }
}

struct Redactor {
    credentials: Regex,
    cookies: Regex,
    authorization: Regex,
    tokens: Regex,
    urls: Regex,
    homes: Regex,
}

pub(super) fn redact(text: &str) -> String {
    static REDACTOR: OnceLock<Redactor> = OnceLock::new();
    let redactor = REDACTOR.get_or_init(|| Redactor {
        credentials: Regex::new(r#"(?i)\b(authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|session[_-]?token|auth[_-]?token|cmux_cua_socket_(?:host_)?auth_token|ticket|otp|proof|authorization[_-]?code|password|client[_-]?secret|x-alwith-native-token|token|secret)([\\"']*\s*[:=]\s*)(?:\\"(?:[^\\\r\n]|\\[^"])*\\"|\\'(?:[^\\\r\n]|\\[^'])*\\'|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+[^\s,;}\]]+|[^\s,;}\]]+)"#).unwrap(),
        cookies: Regex::new(r#"(?im)\b(cookie|set-cookie)([\\"']*\s*[:=]\s*)(?:\\"(?:[^\\\r\n]|\\[^"])*\\"|\\'(?:[^\\\r\n]|\\[^'])*\\'|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)"#).unwrap(),
        authorization: Regex::new(r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+").unwrap(),
        tokens: Regex::new(r"\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)").unwrap(),
        urls: Regex::new(r#"(?i)\b(?:https?|wss?)://[^\s<>"']+"#).unwrap(),
        homes: Regex::new(r"(?:[A-Za-z]:\\Users\\[^\\\s]+|/(?:Users|home)/[^/\s]+)").unwrap(),
    });
    let text = redactor.credentials.replace_all(text, "${1}${2}[redacted]");
    let text = redactor.cookies.replace_all(&text, "${1}${2}[redacted]");
    let text = redactor.authorization.replace_all(&text, "${1} [redacted]");
    let text = redactor.tokens.replace_all(&text, "[redacted]");
    let text = redactor.urls.replace_all(&text, |captures: &Captures<'_>| {
        reqwest::Url::parse(&captures[0])
            .ok()
            .and_then(|url| {
                url.host_str().map(|host| {
                    format!(
                        "{}://{}{}",
                        url.scheme(),
                        host,
                        url.port().map_or(String::new(), |port| format!(":{port}"))
                    )
                })
            })
            .map_or_else(|| "[redacted-url]".into(), |origin| format!("{origin}/[redacted]"))
    });
    redactor.homes.replace_all(&text, "[home]").into_owned()
}

fn read_tail(path: &Path, limit: u64) -> io::Result<(u64, String, bool)> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Log must be a regular file"));
    }
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(limit);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(size - start).read_to_end(&mut bytes)?;
    // Discard a partial first line so a cropped credential cannot lose its label.
    let bytes = if start > 0 {
        bytes.iter().position(|byte| *byte == b'\n').map_or(&[][..], |index| &bytes[index + 1..])
    } else {
        &bytes
    };
    let mut content = redact(&String::from_utf8_lossy(bytes));
    let mut truncated = start > 0;
    if content.len() as u64 > limit {
        let start = content.len() - limit as usize;
        let start = content.as_bytes()[start..].iter().position(|byte| *byte == b'\n').map(|index| start + index + 1);
        content = start.map_or(String::new(), |start| content[start..].into());
        truncated = true;
    }
    Ok((size, content, truncated))
}

pub(super) fn collect(directory: &Path, application_name: &str) -> NativeLogs {
    let mut report =
        NativeLogs { max_total_bytes: TOTAL_BYTES, directory_error_kind: None, omitted_files: 0, files: vec![] };
    let mut rotated = Vec::new();
    match fs::read_dir(directory) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        let name = entry.file_name().to_string_lossy().into_owned();
                        if let Some(stamp) = name
                            .strip_prefix(&format!("{application_name}_"))
                            .and_then(|name| name.strip_suffix(".log"))
                            && stamp.len() == 19
                            && stamp.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'-' | b'_'))
                        {
                            rotated.push(name);
                        }
                    }
                    Err(error) => report.directory_error_kind = Some(format!("{:?}", error.kind())),
                }
            }
        }
        Err(error) => report.directory_error_kind = Some(format!("{:?}", error.kind())),
    }
    rotated.sort_unstable_by(|a, b| b.cmp(a));
    report.omitted_files = rotated.len().saturating_sub(ROTATED_COUNT);
    let mut files = vec![(format!("{application_name}.log"), APPLICATION_BYTES), ("panic.log".into(), PANIC_BYTES)];
    files.extend(rotated.into_iter().take(ROTATED_COUNT).map(|name| (name, ROTATED_BYTES)));
    let mut remaining = TOTAL_BYTES - COMPUTER_BYTES;
    for (name, limit) in files {
        let max_bytes = limit.min(remaining);
        let mut entry = LogFile {
            name,
            archive_path: None,
            original_bytes: None,
            max_bytes,
            truncated: false,
            read_error_kind: None,
            content: String::new(),
        };
        match read_tail(&directory.join(&entry.name), max_bytes) {
            Ok((size, content, truncated)) => {
                remaining -= content.len() as u64;
                entry.archive_path = Some(format!("logs/{}", entry.name));
                entry.original_bytes = Some(size);
                entry.content = content;
                entry.truncated = truncated;
            }
            Err(error) => entry.read_error_kind = Some(format!("{:?}", error.kind())),
        }
        report.files.push(entry);
    }
    report
}

#[cfg(test)]
#[path = "__tests__/diagnostic_logs.rs"]
mod tests;
