//! Bounded local diagnostics. Only projected metadata is persisted, never protocol payloads.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const FILE_BYTES: u64 = 512 * 1024;
const FILE_COUNT: usize = 4;
const MEMORY_EVENTS: usize = 128;
const RETENTION_DAYS: i64 = 7;
const RETENTION_MS: i64 = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL: Duration = Duration::from_secs(3600);
const FUTURE_TOLERANCE_MS: i64 = 5 * 60 * 1000;
static COLLECTOR: OnceLock<Collector> = OnceLock::new();

fn now() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_millis() as i64,
        Err(error) => -(error.duration().as_millis() as i64),
    }
}

fn retained(event: &Event, at: i64) -> bool {
    event.valid()
        && event.timestamp_ms >= at.saturating_sub(RETENTION_MS)
        && event.timestamp_ms <= at.saturating_add(FUTURE_TOLERANCE_MS)
}

fn reference(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))[..24].into()
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    operation: Option<String>,
    request_ref: Option<String>,
    session_ref: Option<String>,
    model_ref: Option<String>,
    provider: Option<String>,
    config: Option<String>,
    state: Option<String>,
    elapsed_ms: Option<u64>,
    rpc_code: Option<i64>,
    error: Option<ErrorSignature>,
    proxy: Option<ModelProxyDiagnostic>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelProxyDiagnostic {
    version: u8,
    request_id: String,
    transport: String,
    destination: String,
    runtime: String,
    stage: String,
    phase: String,
    target_host: Option<String>,
    target_port: Option<u16>,
    endpoint: String,
    status: Option<u16>,
    close_code: Option<u16>,
    upstream_request_id: Option<String>,
    sent_bytes: u64,
    received_bytes: u64,
    first_byte_ms: Option<u64>,
    reused_socket: Option<bool>,
    proxy_env: Vec<String>,
    no_proxy_set: bool,
    elapsed_ms: u64,
    errors: Vec<String>,
}

impl ModelProxyDiagnostic {
    fn valid(&self) -> bool {
        self.version == 1
            && self.request_id.len() == 24
            && self.request_id.bytes().all(|c| c.is_ascii_hexdigit())
            && matches!(self.transport.as_str(), "http" | "websocket")
            && matches!(self.destination.as_str(), "native" | "external")
            && matches!(self.runtime.as_str(), "bun-fetch" | "node-http" | "node-websocket")
            && matches!(
                self.stage.as_str(),
                "resolve_target" | "read_request" | "prepare_request" | "connect_upstream" | "read_response"
            )
            && matches!(self.phase.as_str(), "started" | "headers" | "completed" | "cancelled" | "failed")
            && matches!(
                self.endpoint.as_str(),
                "responses"
                    | "responses/compact"
                    | "images/generations"
                    | "images/edits"
                    | "alpha/search"
                    | "realtime/calls"
                    | "realtime/voices"
                    | "live"
                    | "realtime"
                    | "other"
            )
            && self.target_host.as_deref().is_none_or(|host| {
                host.len() <= 253
                    && reqwest::Url::parse(&format!("https://{host}")).is_ok_and(|url| {
                        url.host_str() == Some(host)
                            && url.path() == "/"
                            && url.port().is_none()
                            && url.username().is_empty()
                            && url.password().is_none()
                            && url.query().is_none()
                            && url.fragment().is_none()
                    })
            })
            && self.status.is_none_or(|status| (100..=599).contains(&status))
            && self.close_code.is_none_or(|code| (1000..=4999).contains(&code))
            && self.upstream_request_id.as_deref().is_none_or(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
            })
            && self.proxy_env.len() <= 6
            && self.proxy_env.iter().all(|name| {
                matches!(
                    name.as_str(),
                    "HTTPS_PROXY" | "https_proxy" | "HTTP_PROXY" | "http_proxy" | "ALL_PROXY" | "all_proxy"
                )
            })
            && self.errors.len() <= 4
            && self.errors.iter().all(|code| {
                matches!(
                    code.as_str(),
                    "UNKNOWN"
                        | "ECONNRESET"
                        | "ECONNREFUSED"
                        | "ETIMEDOUT"
                        | "ENOTFOUND"
                        | "EAI_AGAIN"
                        | "EPIPE"
                        | "ECONNABORTED"
                        | "ABORT_ERR"
                        | "ERR_STREAM_PREMATURE_CLOSE"
                        | "CERT_HAS_EXPIRED"
                        | "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
                        | "DEPTH_ZERO_SELF_SIGNED_CERT"
                        | "SELF_SIGNED_CERT_IN_CHAIN"
                        | "ERR_TLS_CERT_ALTNAME_INVALID"
                )
            })
    }
}

fn model_proxy_context(line: &str) -> Option<Context> {
    const PREFIX: &str = "[alwith-model-proxy] ";
    let json = line.strip_prefix(PREFIX)?;
    if json.len() > 8192 {
        return None;
    }
    let proxy: ModelProxyDiagnostic = serde_json::from_str(json).ok()?;
    if !proxy.valid() {
        return None;
    }
    Some(Context {
        request_ref: Some(proxy.request_id.clone()),
        elapsed_ms: Some(proxy.elapsed_ms),
        proxy: Some(proxy),
        ..Context::default()
    })
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorSignature {
    kind: String,
    fingerprint: String,
    transport_code: Option<String>,
    http_status: Option<u16>,
    loopback_port: Option<u16>,
}

fn signature(message: &str) -> ErrorSignature {
    let lower = message.to_ascii_lowercase();
    let transport_code = [
        "ECONNRESET",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "CERT_HAS_EXPIRED",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    ]
    .into_iter()
    .find(|code| message.contains(code))
    .map(str::to_owned);
    let kind = if lower.contains("session") && lower.contains("not found") {
        "session_not_found"
    } else if lower.contains("responses compatibility proxy") {
        "model_proxy_transport"
    } else if transport_code.is_some() {
        "network_transport"
    } else if lower.contains("timeout") || lower.contains("timed out") {
        "timeout"
    } else if lower.contains("certificate") || lower.contains("tls") {
        "tls"
    } else if lower.contains("connection") || lower.contains("exited") {
        "connection_lost"
    } else if lower.contains("unauthorized") || lower.contains("api key") {
        "authentication"
    } else {
        "unclassified"
    };
    let words = lower.split_whitespace().collect::<Vec<_>>();
    let http_status = words.windows(2).find_map(|pair| {
        (matches!(pair[0].trim_end_matches(':'), "status" | "http")
            && ["400", "401", "403", "404", "408", "429", "500", "502", "503", "504"].contains(&pair[1]))
        .then(|| pair[1].parse().expect("known HTTP status"))
    });
    let loopback_port = message.split_whitespace().find_map(|part| {
        let url = reqwest::Url::parse(part.trim_matches(|c| matches!(c, ',' | ')' | '"' | '\''))).ok()?;
        matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")).then(|| url.port()).flatten()
    });
    ErrorSignature { kind: kind.into(), fingerprint: reference(message), transport_code, http_status, loopback_port }
}

fn rpc_signature(message: &str, data: Option<&Value>) -> ErrorSignature {
    // ACP may put actionable details in data rather than the generic JSON-RPC message.
    let details = data.and_then(|value| value.as_str().or_else(|| value["details"].as_str()));
    signature(details.unwrap_or(message))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    timestamp_ms: i64,
    launch_id: String,
    sequence: u64,
    source: String,
    phase: String,
    context: Context,
}

impl Event {
    fn valid(&self) -> bool {
        let hash = |value: &str| value.len() == 24 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
        let context = &self.context;
        uuid::Uuid::parse_str(&self.launch_id).is_ok()
            && matches!(
                self.source.as_str(),
                "app" | "runtime" | "application_log" | "request" | "agent" | "agent_stderr" | "session"
            )
            && matches!(
                self.phase.as_str(),
                "started"
                    | "succeeded"
                    | "failed"
                    | "interrupted"
                    | "state"
                    | "error"
                    | "warning"
                    | "closed"
                    | "exited"
                    | "recovered"
            )
            && [&context.request_ref, &context.session_ref, &context.model_ref]
                .into_iter()
                .all(|value| value.as_deref().is_none_or(hash))
            && context.operation.as_deref().is_none_or(|value| operation(value) == Some(value))
            && context.provider.as_deref().is_none_or(|value| {
                matches!(value, "openai" | "deepseek" | "litellm" | "openrouter" | "qwen" | "xai" | "custom")
            })
            && context
                .config
                .as_deref()
                .is_none_or(|value| matches!(value, "model" | "effort" | "mode" | "service_tier" | "other"))
            && context
                .state
                .as_deref()
                .is_none_or(|value| matches!(value, "running" | "requires_action" | "done" | "idle"))
            && context.proxy.as_ref().is_none_or(ModelProxyDiagnostic::valid)
            && context.error.as_ref().is_none_or(|error| {
                hash(&error.fingerprint)
                    && matches!(
                        error.kind.as_str(),
                        "session_not_found"
                            | "model_proxy_transport"
                            | "network_transport"
                            | "timeout"
                            | "tls"
                            | "connection_lost"
                            | "authentication"
                            | "unclassified"
                    )
                    && error.transport_code.as_deref().is_none_or(|code| {
                        matches!(
                            code,
                            "ECONNRESET"
                                | "ECONNREFUSED"
                                | "ETIMEDOUT"
                                | "ENOTFOUND"
                                | "EAI_AGAIN"
                                | "CERT_HAS_EXPIRED"
                                | "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
                        )
                    })
            })
    }
}

struct Inner {
    sequence: u64,
    memory: VecDeque<Event>,
    states: HashMap<String, String>,
    write_failed: bool,
    write_error_kind: Option<String>,
    cleanup_failed: bool,
    last_cleanup: Option<Instant>,
    discarded_records: u64,
}

struct Collector {
    directory: PathBuf,
    launch_id: String,
    inner: Mutex<Inner>,
}

impl Collector {
    fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            launch_id: uuid::Uuid::new_v4().to_string(),
            inner: Mutex::new(Inner {
                sequence: 0,
                memory: VecDeque::new(),
                states: HashMap::new(),
                write_failed: false,
                write_error_kind: None,
                cleanup_failed: false,
                last_cleanup: None,
                discarded_records: 0,
            }),
        }
    }

    fn file(&self, index: usize) -> PathBuf {
        self.directory.join(format!("events-{index}.jsonl"))
    }

    fn read(&self, index: usize) -> io::Result<Vec<u8>> {
        let file = fs::File::open(self.file(index))?;
        let mut bytes = Vec::new();
        file.take(FILE_BYTES + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    }

    fn cleanup(&self, at: i64, inner: &mut Inner) {
        inner.memory.retain(|event| retained(event, at));
        let mut failed = false;
        for index in 0..FILE_COUNT {
            let bytes = match self.read(index) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            let mut kept = Vec::new();
            let mut discarded = 0;
            if bytes.len() as u64 <= FILE_BYTES {
                for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
                    match serde_json::from_slice::<Event>(line) {
                        Ok(event) if retained(&event, at) => {
                            // Re-serialize the projection; unknown fields from a damaged file are not copied.
                            serde_json::to_writer(&mut kept, &event).expect("diagnostic metadata serializes");
                            kept.push(b'\n');
                        }
                        _ => discarded += 1,
                    }
                }
            } else {
                discarded += 1;
            }
            if discarded == 0 {
                continue;
            }
            let path = self.file(index);
            let result = if kept.is_empty() {
                fs::remove_file(path)
            } else {
                let staging = self.directory.join(format!("events-{index}.cleanup"));
                (|| -> io::Result<()> {
                    let mut file = OpenOptions::new().create(true).truncate(true).write(true).open(&staging)?;
                    file.write_all(&kept)?;
                    file.sync_all()?;
                    drop(file);
                    fs::rename(&staging, path)
                })()
            };
            if result.is_err() {
                failed = true;
            } else {
                inner.discarded_records += discarded;
            }
        }
        // A process interruption can leave a staging file. Only our exact staging names are removed.
        for index in 0..FILE_COUNT {
            match fs::remove_file(self.directory.join(format!("events-{index}.cleanup"))) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => failed = true,
            }
        }
        inner.cleanup_failed = failed;
        inner.last_cleanup = Some(Instant::now());
    }

    fn maintain(&self) {
        let mut inner = self.inner.lock().expect("diagnostic lock poisoned");
        self.cleanup(now(), &mut inner);
    }

    fn append(&self, event: &Event) -> io::Result<()> {
        fs::create_dir_all(&self.directory)?;
        let bytes = serde_json::to_vec(event)?;
        let current_bytes = match fs::metadata(self.file(0)) {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error),
        };
        if current_bytes + bytes.len() as u64 + 2 > FILE_BYTES {
            for index in (1..FILE_COUNT).rev() {
                let destination = self.file(index);
                if destination.exists() {
                    fs::remove_file(&destination)?;
                }
                let source = self.file(index - 1);
                if source.exists() {
                    fs::rename(source, destination)?;
                }
            }
        }
        let mut file = OpenOptions::new().create(true).read(true).append(true).open(self.file(0))?;
        if file.metadata()?.len() > 0 {
            file.seek(SeekFrom::End(-1))?;
            let mut last = [0];
            file.read_exact(&mut last)?;
            if last[0] != b'\n' {
                file.write_all(b"\n")?;
            }
        }
        file.write_all(&bytes)?;
        file.write_all(b"\n")
    }

    fn record(&self, source: &str, phase: &str, context: Context) {
        let mut inner = self.inner.lock().expect("diagnostic lock poisoned");
        if inner.last_cleanup.is_none_or(|last| last.elapsed() >= CLEANUP_INTERVAL) {
            self.cleanup(now(), &mut inner);
        }
        inner.sequence += 1;
        let event = Event {
            timestamp_ms: now(),
            launch_id: self.launch_id.clone(),
            sequence: inner.sequence,
            source: source.into(),
            phase: phase.into(),
            context,
        };
        if inner.memory.len() == MEMORY_EVENTS {
            inner.memory.pop_front();
        }
        inner.memory.push_back(event.clone());
        // I/O errors are reported in the export; logging here would recurse through the logger.
        if let Err(error) = self.append(&event) {
            inner.write_failed = true;
            inner.write_error_kind = Some(format!("{:?}", error.kind()));
        }
    }

    fn state(&self, session: &str, state: &str) {
        let key = reference(session);
        let mut inner = self.inner.lock().expect("diagnostic lock poisoned");
        if inner.states.get(&key).is_some_and(|previous| previous == state) {
            return;
        }
        if inner.states.len() >= 1024 {
            inner.states.clear();
        }
        inner.states.insert(key.clone(), state.into());
        drop(inner);
        self.record(
            "runtime",
            "state",
            Context { session_ref: Some(key), state: Some(state.into()), ..Context::default() },
        );
    }

    fn report(&self) -> io::Result<Value> {
        let mut inner = self.inner.lock().expect("diagnostic lock poisoned");
        let at = now();
        self.cleanup(at, &mut inner);
        let mut events = Vec::<Event>::new();
        let mut incomplete_files = 0;
        for index in (0..FILE_COUNT).rev() {
            match self.read(index) {
                Ok(bytes) if bytes.len() as u64 <= FILE_BYTES => {
                    for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
                        match serde_json::from_slice(line) {
                            Ok(event) if retained(&event, at) => events.push(event),
                            Ok(_) => {}
                            Err(_) => incomplete_files += 1,
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                _ => incomplete_files += 1,
            }
        }
        for event in &inner.memory {
            if !events
                .iter()
                .any(|existing| existing.launch_id == event.launch_id && existing.sequence == event.sequence)
            {
                events.push(event.clone());
            }
        }
        let mut launches = HashMap::new();
        for event in &events {
            let position = launches.len();
            launches.entry(event.launch_id.clone()).or_insert(position);
        }
        // Preserve causal order within a launch even when the system clock moves backwards.
        events.sort_by_key(|event| (launches[&event.launch_id], event.sequence));
        Ok(json!({
            "schema": "alwith-u-diagnostics-v1", "exportedAtMs": now(),
            "app": {"version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"arch":std::env::consts::ARCH},
            "recording": {"retentionDays":RETENTION_DAYS,"cleanupIntervalSeconds":CLEANUP_INTERVAL.as_secs(),
                "maxDiskBytes":FILE_BYTES * FILE_COUNT as u64,"writeFailed":inner.write_failed,"writeErrorKind":inner.write_error_kind,
                "cleanupFailed":inner.cleanup_failed,"discardedRecords":inner.discarded_records,"incompleteRecords":incomplete_files},
            "privacy": "Metadata only, including model proxy target hostnames and upstream request IDs. No conversation, credentials, raw protocol frames, full URLs, file paths or original error messages.",
            "events": events,
        }))
    }
}

fn record(source: &str, phase: &str, context: Context) {
    if let Some(collector) = COLLECTOR.get() {
        collector.record(source, phase, context);
    }
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_log_dir().map_err(|error| error.to_string())?.join("diagnostics");
    COLLECTOR.set(Collector::new(directory)).map_err(|_| "Diagnostics already initialized")?;
    record("app", "started", Context::default());
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(CLEANUP_INTERVAL).await;
            let _ = tokio::task::spawn_blocking(|| {
                COLLECTOR.get().expect("diagnostics initialized before maintenance").maintain();
            })
            .await;
        }
    });
    Ok(())
}

pub fn native_log(level: log::Level, message: &str) {
    if level <= log::Level::Warn {
        record(
            "application_log",
            if level == log::Level::Error { "error" } else { "warning" },
            Context { error: Some(signature(message)), ..Context::default() },
        );
    }
}

fn operation(method: &str) -> Option<&str> {
    match method {
        "initialize"
        | "session/new"
        | "session/resume"
        | "session/load"
        | "session/fork"
        | "session/close"
        | "session/delete"
        | "session/prompt"
        | "session/cancel"
        | "session/set_config_option"
        | "providers/set"
        | "providers/disable"
        | "auth/login"
        | "start" => Some(method),
        "sessionNew" => Some("session/new"),
        "sessionResume" => Some("session/resume"),
        "sessionLoad" => Some("session/load"),
        "sessionFork" => Some("session/fork"),
        "prompt" => Some("session/prompt"),
        _ => None,
    }
}

fn model_context(model: &str, context: &mut Context) {
    context.model_ref = Some(reference(model));
    let provider = model.strip_prefix("gateway:").and_then(|value| value.split(':').next()).unwrap_or("openai");
    context.provider = Some(
        match provider {
            "openai" | "deepseek" | "litellm" | "openrouter" | "qwen" | "xai" => provider,
            _ => "custom",
        }
        .into(),
    );
}

pub struct RequestTrace {
    context: Option<Context>,
    started: Instant,
    finished: bool,
}

impl RequestTrace {
    pub fn begin(method: &str, params: Option<&Value>, request_id: &str) -> Self {
        let empty = Value::Null;
        let params = params.unwrap_or(&empty);
        let (method, body) = if method == "acpRequest" {
            (params["method"].as_str().unwrap_or(""), &params["params"])
        } else {
            (method, params)
        };
        let context = operation(method).map(|method| {
            let mut context = Context {
                operation: Some(method.into()),
                request_ref: Some(reference(request_id)),
                session_ref: body["sessionId"].as_str().map(reference),
                ..Context::default()
            };
            if let Some(config) = body["configId"].as_str() {
                context.config = Some(
                    match config {
                        "model" | "effort" | "mode" | "service_tier" => config,
                        _ => "other",
                    }
                    .into(),
                );
                if config == "model"
                    && let Some(model) = body["value"].as_str()
                {
                    model_context(model, &mut context);
                }
            }
            if let Some(model) =
                body.pointer("/_meta/alwith/model").and_then(Value::as_str).or_else(|| body["model"].as_str())
            {
                model_context(model, &mut context);
            }
            record("request", "started", context.clone());
            context
        });
        Self { context, started: Instant::now(), finished: false }
    }

    pub fn finish(&mut self, result: &Result<Value, alwith_api::ResponseError>) {
        self.finished = true;
        let Some(mut context) = self.context.clone() else {
            return;
        };
        context.elapsed_ms = Some(self.started.elapsed().as_millis() as u64);
        let phase = match result {
            Ok(value) => {
                if let Some(id) = value["sessionId"].as_str() {
                    context.session_ref = Some(reference(id));
                }
                if let Some(options) = value["configOptions"].as_array()
                    && let Some(model) = options
                        .iter()
                        .find(|option| option["category"] == "model")
                        .and_then(|option| option["currentValue"].as_str())
                {
                    model_context(model, &mut context);
                }
                "succeeded"
            }
            Err(error) => {
                context.rpc_code = Some(error.code);
                context.error = Some(rpc_signature(&error.message, error.data.as_ref()));
                "failed"
            }
        };
        record("request", phase, context);
    }
}

impl Drop for RequestTrace {
    fn drop(&mut self) {
        if !self.finished
            && let Some(mut context) = self.context.take()
        {
            context.elapsed_ms = Some(self.started.elapsed().as_millis() as u64);
            record("request", "interrupted", context);
        }
    }
}

pub fn runtime_event(event: &alwith_api::RuntimeEvent) {
    use alwith_api::RuntimeEvent;
    match event {
        RuntimeEvent::Exit { .. } => record("agent", "exited", Context::default()),
        RuntimeEvent::Stderr { line, .. } => {
            if let Some(context) = model_proxy_context(line) {
                let phase = match context.proxy.as_ref().expect("validated proxy event").phase.as_str() {
                    "started" => "started",
                    "headers" => "state",
                    "completed" => "succeeded",
                    "cancelled" => "interrupted",
                    "failed" => "failed",
                    _ => unreachable!("validated proxy phase"),
                };
                record("agent_stderr", phase, context);
                return;
            }
            let error = signature(line);
            if error.kind != "unclassified" {
                record("agent_stderr", "error", Context { error: Some(error), ..Context::default() });
            }
        }
        RuntimeEvent::RunStates { sessions } => {
            if let Some(collector) = COLLECTOR.get() {
                for session in sessions {
                    let state = match session.state {
                        alwith_api::RunState::Running => "running",
                        alwith_api::RunState::RequiresAction => "requires_action",
                        alwith_api::RunState::Done => "done",
                        alwith_api::RunState::Idle => "idle",
                    };
                    collector.state(&session.session_id, state);
                }
            }
        }
        RuntimeEvent::AcpNotification { method, params, .. } if method == "session/update" => {
            let update = &params["update"];
            let error = update["error"]["message"].as_str();
            if let Some(message) = error {
                record(
                    "session",
                    "error",
                    Context {
                        session_ref: params["sessionId"].as_str().map(reference),
                        error: Some(rpc_signature(message, update["error"].get("data"))),
                        ..Context::default()
                    },
                );
            }
        }
        _ => {}
    }
}

pub fn runtime_closed(reason: &str) {
    record("runtime", "closed", Context { error: Some(signature(reason)), ..Context::default() });
}

fn write_report(path: &Path, report: &Value) -> io::Result<()> {
    let parent =
        path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Export needs a parent directory"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), report)?;
    temporary.as_file_mut().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[tauri3_specta::command]
pub async fn diagnostics_export(window: tauri::WebviewWindow) -> Result<bool, String> {
    if !matches!(window.label(), "main" | "settings" | "chat") {
        return Err("Diagnostics export is unavailable in this window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(format!("alwith-u-diagnostics-{}.json", now()))
            .add_filter("Diagnostic report", &["json"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let report =
            COLLECTOR.get().ok_or("Diagnostics are not initialized")?.report().map_err(|error| error.to_string())?;
        let path = selected.into_path().map_err(|error| error.to_string())?;
        write_report(&path, &report).map_err(|error| error.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "__tests__/diagnostics.rs"]
mod tests;
