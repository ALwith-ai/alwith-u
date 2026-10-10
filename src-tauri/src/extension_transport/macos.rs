//! Unix socket transport and same-user checks for macOS.
use super::remaining;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    time::Instant,
};
pub(crate) type Stream = UnixStream;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Endpoint {
    protocol_version: u32,
    socket_path: PathBuf,
}
fn connect_root(root: &std::path::Path) -> Result<UnixStream, String> {
    let metadata = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err("Invalid extension control directory ownership or permissions".into());
    }
    let path = root.join("endpoint.json");
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.len() > 4096
    {
        return Err("Invalid extension control endpoint".into());
    }
    let endpoint: Endpoint =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if endpoint.protocol_version != 1 {
        return Err("Unsupported extension control protocol".into());
    }
    let stream = UnixStream::connect(endpoint.socket_path).map_err(|e| e.to_string())?;
    check_peer(&stream)?;
    Ok(stream)
}

pub(crate) fn connect(identifier: &str) -> Result<Stream, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is unavailable")?;
    connect_root(&PathBuf::from(home).join("Library/Caches").join(identifier).join("extension-control"))
}
pub(crate) fn private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() || meta.uid() != unsafe { libc::geteuid() } {
        return Err("Control directory must belong to the current user and cannot be a link".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())
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
pub(crate) struct DeadlineReader {
    stream: UnixStream,
    deadline: Instant,
}
impl Read for DeadlineReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            remaining(self.deadline)?;
            match self.stream.read(buffer) {
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    let timeout = remaining(self.deadline)?;
                    let milliseconds = timeout
                        .as_millis()
                        .saturating_add(u128::from(!timeout.subsec_nanos().is_multiple_of(1_000_000)));
                    let mut descriptor = libc::pollfd { fd: self.stream.as_raw_fd(), events: libc::POLLIN, revents: 0 };
                    // poll also wakes on peer closure, so buffered terminal bytes remain readable.
                    // Updating SO_RCVTIMEO after closure would fail with EINVAL on macOS.
                    let ready = unsafe { libc::poll(&mut descriptor, 1, milliseconds.min(i32::MAX as u128) as i32) };
                    if ready < 0 {
                        let error = io::Error::last_os_error();
                        if error.kind() != io::ErrorKind::Interrupted {
                            return Err(error);
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                result => return result,
            }
        }
    }
}

impl DeadlineReader {
    pub(crate) fn new(stream: Stream, deadline: Instant) -> io::Result<Self> {
        stream.set_nonblocking(true)?;
        Ok(Self { stream, deadline })
    }
}
pub(crate) struct Listener {
    listener: UnixListener,
    _directory: tempfile::TempDir,
}
impl Listener {
    pub(crate) fn bind(root: &Path, _identifier: &str) -> Result<Self, String> {
        let directory = tempfile::Builder::new().prefix("alwith-u-").tempdir_in("/tmp").map_err(|e| e.to_string())?;
        private_directory(directory.path())?;
        let socket_path = directory.path().join("control.sock");
        let listener = UnixListener::bind(&socket_path).map_err(|e| e.to_string())?;
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        crate::extension_control::atomic_json(
            &root.join("endpoint.json"),
            &Endpoint { protocol_version: 1, socket_path },
        )?;
        Ok(Self { listener, _directory: directory })
    }
    pub(crate) fn accept(&mut self) -> io::Result<Stream> {
        self.listener.accept().map(|(stream, _)| stream)
    }
}

pub(crate) fn wait_for_peer_close(_stream: &mut Stream) -> io::Result<()> {
    Ok(())
}

pub(crate) fn is_link(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}
