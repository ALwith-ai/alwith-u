//! Native-only admission for explicit same-user CLI installation requests.
use crate::legacy_extensions::importer::{PreparedInstall, prepare_install_from_directory};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager};

pub(crate) const EVENT: &str = "extension-control:queued";
const MAX_FRAME: u64 = 16 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstallRequest {
    pub request_id: String,
    pub path: String,
    pub update: bool,
    pub enable: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UninstallRequest {
    pub request_id: String,
    pub id: String,
    pub purge: bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub(crate) enum ControlRequest {
    Install(InstallRequest),
    Uninstall(UninstallRequest),
}
impl From<InstallRequest> for ControlRequest {
    fn from(request: InstallRequest) -> Self {
        Self::Install(request)
    }
}
impl From<UninstallRequest> for ControlRequest {
    fn from(request: UninstallRequest) -> Self {
        Self::Uninstall(request)
    }
}
impl ControlRequest {
    fn request_id(&self) -> &str {
        match self {
            Self::Install(request) => &request.request_id,
            Self::Uninstall(request) => &request.request_id,
        }
    }
}
pub(crate) fn valid_extension_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && !id.as_bytes()[0].is_ascii_uppercase()
        && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum WireRequest {
    Install {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(flatten)]
        request: InstallRequest,
    },
    Uninstall {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(flatten)]
        request: UninstallRequest,
    },
    Result {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId")]
        request_id: String,
    },
}
impl WireRequest {
    fn validate(&self) -> Result<(), String> {
        let (version, id) = match self {
            Self::Install { protocol_version, request } => (*protocol_version, &request.request_id),
            Self::Uninstall { protocol_version, request } => {
                if !valid_extension_id(&request.id) {
                    return Err("Invalid extension ID".into());
                }
                (*protocol_version, &request.request_id)
            }
            Self::Result { protocol_version, request_id } => (*protocol_version, request_id),
        };
        if version != 1 {
            return Err("Unsupported extension control protocol".into());
        }
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid request ID".to_string())?;
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstallError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Outcome {
    pub request_id: String,
    pub exit_code: i32,
    pub id: Option<String>,
    pub version: Option<String>,
    pub package_revision: Option<String>,
    pub installed: bool,
    pub enabled: bool,
    pub active_in_main_window: bool,
    pub error: Option<InstallError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_purged: Option<bool>,
}
impl Outcome {
    pub(crate) fn failure(id: &str, exit_code: i32, code: &str, message: &str) -> Self {
        Self {
            request_id: id.into(),
            exit_code,
            id: None,
            version: None,
            package_revision: None,
            installed: false,
            enabled: false,
            active_in_main_window: false,
            error: Some(InstallError { code: code.into(), message: message.into() }),
            data_purged: None,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Frame {
    Accepted {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Result {
        result: Outcome,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    request: ControlRequest,
    processing: bool,
    selected_id: Option<String>,
    result: Option<Outcome>,
    #[serde(skip)]
    waiters: usize,
}

pub(crate) struct Control {
    root: PathBuf,
    records: Mutex<BTreeMap<String, Record>>,
    changed: Condvar,
    running: AtomicBool,
    unavailable: Mutex<Option<String>>,
}

struct PreparationClaim<'a> {
    control: &'a Control,
    request: ControlRequest,
    delivered: bool,
}
impl PreparationClaim<'_> {
    fn deliver(mut self) {
        self.delivered = true;
    }
}
impl Drop for PreparationClaim<'_> {
    fn drop(&mut self) {
        if self.delivered {
            return;
        }
        match self.control.records.lock() {
            Ok(mut records) => {
                if let Some(record) = records.get_mut(self.request.request_id())
                    && record.result.is_none()
                {
                    // No installer has received this job. Retry preparation after transient IO
                    // failure; retain the durable processing marker for conservative crash recovery.
                    record.processing = false;
                }
            }
            Err(error) => log::error!("Cannot release extension preparation claim: {error}"),
        }
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing control parent directory")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

fn private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() || meta.uid() != unsafe { libc::geteuid() } {
        return Err("Control directory must belong to the current user and cannot be a link".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
}

impl Control {
    fn open(root: &Path) -> Result<Self, String> {
        private_directory(root)?;
        let path = root.join("requests.json");
        let mut records: BTreeMap<String, Record> = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Invalid control results: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        for (id, record) in &mut records {
            uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
            if record.result.is_none() {
                record.result = Some(Outcome::failure(
                    id,
                    6,
                    "resultUnknown",
                    "Application restarted before completion; inspect the installed extension before retrying",
                ));
            }
        }
        atomic_json(&path, &records)?;
        Ok(Self {
            root: root.into(),
            records: Mutex::new(records),
            changed: Condvar::new(),
            running: AtomicBool::new(true),
            unavailable: Mutex::new(None),
        })
    }
    fn save(&self, records: &BTreeMap<String, Record>) -> Result<(), String> {
        atomic_json(&self.root.join("requests.json"), records)
    }
    fn admit(&self, request: impl Into<ControlRequest>, watch: bool) -> Result<(), String> {
        let request = request.into();
        uuid::Uuid::parse_str(request.request_id()).map_err(|e| e.to_string())?;
        match &request {
            ControlRequest::Install(request)
                if !Path::new(&request.path).is_absolute() || !Path::new(&request.path).is_dir() =>
            {
                return Err("Install path must be an absolute directory".into());
            }
            ControlRequest::Uninstall(request) if !valid_extension_id(&request.id) => {
                return Err("Invalid extension ID".into());
            }
            _ => {}
        }
        let mut records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        if let Some(error) = self.unavailable.lock().map_err(|_| "Control lock poisoned")?.as_ref() {
            return Err(format!("Extension host is unavailable: {error}"));
        }
        if let Some(record) = records.get_mut(request.request_id()) {
            if record.request != request {
                return Err("Request ID already belongs to another operation".into());
            }
            record.waiters += usize::from(watch);
            return Ok(());
        }
        let mut next = records.clone();
        // Bound receipts without dropping outstanding operations.
        if next.len() >= 256 {
            let removable = next
                .iter()
                .find(|(_, record)| record.result.is_some() && record.waiters == 0)
                .map(|(id, _)| id.clone());
            if let Some(id) = removable {
                next.remove(&id);
            } else {
                return Err("Extension operation queue is full".into());
            }
        }
        next.insert(
            request.request_id().into(),
            Record { request, processing: false, selected_id: None, result: None, waiters: usize::from(watch) },
        );
        self.save(&next)?;
        *records = next;
        self.changed.notify_all();
        Ok(())
    }
    fn next(&self) -> Result<Option<ControlRequest>, String> {
        let mut records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        let Some(id) =
            records.iter().find(|(_, record)| !record.processing && record.result.is_none()).map(|(id, _)| id.clone())
        else {
            return Ok(None);
        };
        let mut next = records.clone();
        let record = next.get_mut(&id).ok_or("Queued request disappeared")?;
        record.processing = true;
        let request = record.request.clone();
        self.save(&next)?;
        *records = next;
        Ok(Some(request))
    }
    fn claim_next(&self) -> Result<Option<PreparationClaim<'_>>, String> {
        Ok(self.next()?.map(|request| PreparationClaim { control: self, request, delivered: false }))
    }
    fn select(&self, request_id: &str, id: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        let mut next = records.clone();
        next.get_mut(request_id).ok_or("Unknown request")?.selected_id = Some(id.into());
        self.save(&next)?;
        *records = next;
        Ok(())
    }
    fn finish(&self, result: Outcome) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        let mut next = records.clone();
        let record = next.get_mut(&result.request_id).ok_or("Unknown request")?;
        if !record.processing || record.result.is_some() {
            return Err("Request is not in progress".into());
        }
        record.result = Some(result);
        self.save(&next)?;
        *records = next;
        self.changed.notify_all();
        Ok(())
    }
    fn result(&self, id: &str) -> Result<Option<Outcome>, String> {
        let records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        Ok(records.get(id).ok_or("Unknown or expired request ID")?.result.clone())
    }
    fn unavailable(&self, message: &str) -> Result<(), String> {
        let mut records = self.records.lock().map_err(|_| "Control lock poisoned")?;
        let mut next = records.clone();
        for (id, record) in &mut next {
            if record.result.is_none() {
                record.result = Some(Outcome::failure(
                    id,
                    if record.processing { 6 } else { 4 },
                    if record.processing { "resultUnknown" } else { "hostUnavailable" },
                    message,
                ));
            }
        }
        // Admission must close even when persisting the terminal receipts fails.
        *self.unavailable.lock().map_err(|_| "Control lock poisoned")? = Some(message.into());
        *records = next;
        self.changed.notify_all();
        self.save(&records)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Endpoint {
    pub protocol_version: u32,
    pub socket_path: PathBuf,
}

pub(crate) fn read_frame<T: for<'de> Deserialize<'de>>(reader: &mut impl BufRead) -> Result<T, String> {
    let mut bytes = Vec::new();
    std::io::Read::take(reader, MAX_FRAME + 1).read_until(b'\n', &mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Err("Invalid or oversized control frame".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
pub(crate) fn write_frame(stream: &mut UnixStream, frame: &impl Serialize) -> Result<(), String> {
    serde_json::to_writer(&mut *stream, frame).map_err(|e| e.to_string())?;
    stream.write_all(b"\n").map_err(|e| e.to_string())
}

pub(crate) fn check_peer(stream: &UnixStream) -> Result<(), String> {
    let mut uid = 0;
    let mut gid = 0;
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if uid != unsafe { libc::geteuid() } {
        return Err("Extension control only accepts the current user".into());
    }
    Ok(())
}

fn handle_connection(
    mut stream: UnixStream, control: &Control, notify: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    check_peer(&stream)?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    let request: WireRequest = read_frame(&mut BufReader::new(stream.try_clone().map_err(|e| e.to_string())?))?;
    request.validate()?;
    let id = match request {
        WireRequest::Install { request, .. } => {
            control.admit(request.clone(), true)?;
            // The durable queue is authoritative; notification failure cannot undo admission.
            if let Err(error) = notify() {
                log::warn!("extension install queued, notification failed: {error}");
            }
            request.request_id
        }
        WireRequest::Uninstall { request, .. } => {
            let id = request.request_id.clone();
            control.admit(request, true)?;
            if let Err(error) = notify() {
                log::warn!("extension uninstall queued, notification failed: {error}");
            }
            id
        }
        WireRequest::Result { request_id, .. } => {
            let result = control.result(&request_id)?.unwrap_or_else(|| {
                Outcome::failure(&request_id, 6, "pending", "Extension operation is still in progress")
            });
            return write_frame(&mut stream, &Frame::Result { result });
        }
    };
    let _waiting = ReceiptWaiter { control, id: id.clone() };
    write_frame(&mut stream, &Frame::Accepted { request_id: id.clone() })?;
    let mut records = control.records.lock().map_err(|_| "Control lock poisoned")?;
    loop {
        if let Some(result) = records.get(&id).and_then(|record| record.result.clone()) {
            drop(records);
            return write_frame(&mut stream, &Frame::Result { result });
        }
        if !control.running.load(Ordering::Acquire) {
            drop(records);
            return write_frame(
                &mut stream,
                &Frame::Result {
                    result: Outcome::failure(
                        &id,
                        6,
                        "resultUnknown",
                        "Application stopped before completion; query the request result before retrying",
                    ),
                },
            );
        }
        let (guard, timeout) =
            control.changed.wait_timeout(records, Duration::from_secs(3600)).map_err(|_| "Control lock poisoned")?;
        records = guard;
        if timeout.timed_out() {
            drop(records);
            return write_frame(
                &mut stream,
                &Frame::Result {
                    result: Outcome::failure(&id, 6, "pending", "Extension operation is still in progress"),
                },
            );
        }
    }
}

struct ReceiptWaiter<'a> {
    control: &'a Control,
    id: String,
}
impl Drop for ReceiptWaiter<'_> {
    fn drop(&mut self) {
        match self.control.records.lock() {
            Ok(mut records) => {
                if let Some(record) = records.get_mut(&self.id) {
                    record.waiters = record.waiters.saturating_sub(1);
                }
            }
            Err(error) => log::error!("Cannot release extension receipt waiter: {error}"),
        }
    }
}

pub(crate) struct ExtensionControl {
    service: Result<RunningControl, String>,
}
struct RunningControl {
    control: Arc<Control>,
    _socket_directory: tempfile::TempDir,
}
impl ExtensionControl {
    pub(crate) fn failed(error: String) -> Self {
        Self { service: Err(error) }
    }
    fn control(&self) -> Result<&Arc<Control>, String> {
        self.service.as_ref().map(|service| &service.control).map_err(Clone::clone)
    }
    pub(crate) fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("extension-control");
        let control = Arc::new(Control::open(&root)?);
        // A short, private path avoids sockaddr_un's macOS path-length limit.
        let socket_directory =
            tempfile::Builder::new().prefix("alwith-u-").tempdir_in("/tmp").map_err(|e| e.to_string())?;
        private_directory(socket_directory.path())?;
        let socket_path = socket_directory.path().join("control.sock");
        let listener = UnixListener::bind(&socket_path).map_err(|e| e.to_string())?;
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        atomic_json(&root.join("endpoint.json"), &Endpoint { protocol_version: 1, socket_path })?;
        let server = control.clone();
        let app = app.clone();
        thread::Builder::new()
            .name("extension-control".into())
            .spawn(move || {
                while server.running.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let server = server.clone();
                            let app = app.clone();
                            if let Err(error) =
                                thread::Builder::new().name("extension-install-client".into()).spawn(move || {
                                    let error_stream = stream.try_clone();
                                    if let Err(message) = handle_connection(stream, &server, || {
                                        app.emit_to("main", EVENT, ()).map_err(|e| e.to_string())
                                    }) {
                                        match error_stream {
                                            Ok(mut stream) => {
                                                if let Err(error) = write_frame(&mut stream, &Frame::Error { message })
                                                {
                                                    log::debug!("extension client disconnected: {error}");
                                                }
                                            }
                                            Err(error) => {
                                                log::debug!("Cannot report extension client failure: {error}")
                                            }
                                        }
                                    }
                                })
                            {
                                log::error!("Cannot start extension client handler: {error}");
                            }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(25))
                        }
                        Err(error) => {
                            log::error!("Extension control socket failed: {error}");
                            break;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { service: Ok(RunningControl { control, _socket_directory: socket_directory }) })
    }
    pub(crate) fn stop(&self) {
        if let Ok(control) = self.control() {
            control.running.store(false, Ordering::Release);
            control.changed.notify_all();
        }
    }
}
impl Drop for ExtensionControl {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Serialize, specta::Type)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub(crate) enum ControlJob {
    #[serde(rename_all = "camelCase")]
    Install { request_id: String, prepared: Box<PreparedInstall>, update: bool, enable: bool },
    #[serde(rename_all = "camelCase")]
    Uninstall { request_id: String, id: String },
}

fn require_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window processes CLI installation requests".into());
    }
    Ok(())
}

#[tauri3_specta::command]
pub(crate) async fn extension_control_next(window: tauri::Window) -> Result<Option<ControlJob>, String> {
    require_main(&window)?;
    loop {
        let control = window.state::<ExtensionControl>().control()?.clone();
        let Some(claim) = control.claim_next()? else { return Ok(None) };
        let request = match claim.request.clone() {
            ControlRequest::Install(request) => request,
            ControlRequest::Uninstall(request) => {
                control.select(&request.request_id, &request.id)?;
                claim.deliver();
                return Ok(Some(ControlJob::Uninstall { request_id: request.request_id, id: request.id }));
            }
        };
        match prepare_install_from_directory(&window, Path::new(&request.path), None).await {
            Ok(prepared) => {
                let id = prepared.id()?;
                control.select(&request.request_id, id)?;
                claim.deliver();
                return Ok(Some(ControlJob::Install {
                    request_id: request.request_id,
                    prepared: Box::new(prepared),
                    update: request.update,
                    enable: request.enable,
                }));
            }
            Err(error) => control.finish(Outcome::failure(&request.request_id, 4, "prepareFailed", &error))?,
        }
    }
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Report {
    id: String,
    version: String,
    package_revision: String,
    installed: bool,
    enabled: bool,
    active_in_main_window: bool,
    error: Option<InstallError>,
}

fn reconcile_report(mut actual: Outcome, report: Report, requested_enable: bool, pending: bool) -> Outcome {
    let matches = report.installed
        && actual.installed
        && actual.id.as_deref() == Some(&report.id)
        && actual.version.as_deref() == Some(&report.version)
        && actual.package_revision.as_deref() == Some(&report.package_revision)
        && actual.enabled == report.enabled
        && !pending;
    if !matches || (requested_enable && (!report.enabled || !report.active_in_main_window) && report.error.is_none()) {
        actual.exit_code = 6;
        actual.error = Some(InstallError {
            code: "stateChanged".into(),
            message: "Extension state changed before the receipt was committed; inspect the installed extension".into(),
        });
    } else {
        actual.active_in_main_window = report.active_in_main_window;
        actual.exit_code = if report.error.is_some() { 5 } else { 0 };
        actual.error = report.error;
    }
    actual
}

#[tauri3_specta::command]
pub(crate) fn extension_control_complete(
    window: tauri::Window, request_id: String, result: Option<Report>, error: Option<String>,
) -> Result<(), String> {
    require_main(&window)?;
    let state = window.state::<ExtensionControl>();
    let control = state.control()?;
    let record = control
        .records
        .lock()
        .map_err(|_| "Control lock poisoned")?
        .get(&request_id)
        .cloned()
        .ok_or("Unknown request")?;
    let uninstall = matches!(&record.request, ControlRequest::Uninstall(_));
    let mut outcome = Outcome::failure(
        &request_id,
        4,
        if uninstall { "uninstallFailed" } else { "installFailed" },
        error.as_deref().unwrap_or(if uninstall { "Uninstall failed" } else { "Installation failed" }),
    );
    let snapshot = alwith_extension::plugin::snapshot(window.app_handle()).map_err(|e| e.to_string())?;
    if let Some(installed) = snapshot.installations.iter().find(|item| Some(&item.id) == record.selected_id.as_ref()) {
        outcome.id = Some(installed.id.clone());
        outcome.version = Some(installed.manifest.version.clone());
        outcome.package_revision = Some(installed.package_revision.clone());
        outcome.installed = true;
        outcome.enabled = installed.enabled;
    }
    if let ControlRequest::Uninstall(request) = &record.request {
        outcome.id = Some(request.id.clone());
        let pending = snapshot.pending.iter().any(|item| item.id == request.id);
        if let Some(report) = result {
            if report.id != request.id || report.installed || outcome.installed || pending {
                outcome.exit_code = 6;
                outcome.error = Some(InstallError {
                    code: "stateChanged".into(),
                    message: "Extension changed before uninstall completion".into(),
                });
            } else {
                let cleanup = crate::legacy_extensions::importer::cleanup_uninstalled(
                    window.app_handle(),
                    &request.id,
                    request.purge,
                    || purge_private_files(&window.path().app_data_dir().map_err(|e| e.to_string())?, &request.id),
                );
                match cleanup {
                    Ok(()) => {
                        outcome.exit_code = 0;
                        outcome.error = None;
                        outcome.data_purged = Some(request.purge);
                    }
                    Err(message) => {
                        outcome.error = Some(InstallError { code: "cleanupFailed".into(), message });
                    }
                }
            }
        }
        return control.finish(outcome);
    }
    if let Some(report) = result {
        let pending = snapshot.pending.iter().any(|item| Some(&item.id) == record.selected_id.as_ref());
        outcome = reconcile_report(
            outcome,
            report,
            match record.request {
                ControlRequest::Install(request) => request.enable,
                ControlRequest::Uninstall(_) => unreachable!(),
            },
            pending,
        );
    }
    control.finish(outcome)
}

fn purge_private_files(root: &Path, id: &str) -> Result<(), String> {
    if !valid_extension_id(id) {
        return Err("Invalid extension ID".into());
    }
    for category in ["legacy-extension-files", "extension-files"] {
        let parent = root.join(category);
        match fs::symlink_metadata(&parent) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err("Invalid extension private root".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
        let path = parent.join(id);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err("Invalid extension private directory".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri3_specta::command]
pub(crate) fn extension_control_unavailable(window: tauri::Window, message: String) -> Result<(), String> {
    require_main(&window)?;
    window.state::<ExtensionControl>().control()?.unavailable(&message)
}

#[tauri3_specta::command]
pub(crate) fn extension_control_status(window: tauri::Window) -> Result<(), String> {
    require_main(&window)?;
    window.state::<ExtensionControl>().control().map(|_| ())
}

#[cfg(test)]
#[path = "__tests__/extension_control.rs"]
mod tests;
