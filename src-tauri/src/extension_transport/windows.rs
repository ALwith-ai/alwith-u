//! Local, same-user named pipes. Overlapped operations keep CLI deadlines bounded.
use super::remaining;
use sha2::{Digest, Sha256};
use std::{
    cell::Cell,
    ffi::c_void,
    fs,
    io::{self, Read, Write},
    os::windows::{
        ffi::OsStrExt,
        fs::MetadataExt,
        io::{AsRawHandle, BorrowedHandle, FromRawHandle, IntoRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
    sync::Arc,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{Console::*, IO::*, Pipes::*, Threading::*},
};

fn wide(value: &std::ffi::OsStr) -> io::Result<Vec<u16>> {
    let mut value: Vec<u16> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Embedded NUL"));
    }
    value.push(0);
    Ok(value)
}
fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }
}
struct LocalMemory(*mut c_void);
impl Drop for LocalMemory {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
fn sid_string(sid: PSID) -> io::Result<String> {
    let mut text = null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _memory = LocalMemory(text.cast());
    let mut length = 0;
    unsafe {
        while *text.add(length) != 0 {
            length += 1;
        }
        String::from_utf16(std::slice::from_raw_parts(text, length))
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }
}
fn process_sid(process: HANDLE) -> io::Result<String> {
    token_sid(process, false)
}
fn token_sid(process: HANDLE, default_owner: bool) -> io::Result<String> {
    let information = if default_owner { TokenOwner } else { TokenUser };
    let mut token = null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = owned(token)?;
    let mut size = 0;
    unsafe {
        GetTokenInformation(token.as_raw_handle(), information, null_mut(), 0, &mut size);
    }
    if size == 0 {
        return Err(io::Error::last_os_error());
    }
    // TOKEN_USER contains pointers; use pointer-aligned storage rather than Vec<u8>.
    let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe { GetTokenInformation(token.as_raw_handle(), information, buffer.as_mut_ptr().cast(), size, &mut size) }
        == 0
    {
        return Err(io::Error::last_os_error());
    }
    sid_string(unsafe {
        if default_owner {
            (*(buffer.as_ptr().cast::<TOKEN_OWNER>())).Owner
        } else {
            (*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid
        }
    })
}
fn current_sid() -> io::Result<String> {
    process_sid(unsafe { GetCurrentProcess() })
}
fn descriptor() -> io::Result<LocalMemory> {
    let sddl = wide(std::ffi::OsStr::new(&format!("O:{sid}D:P(A;OICI;GA;;;{sid})", sid = current_sid()?)))?;
    let mut value = null_mut();
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut value, null_mut()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(LocalMemory(value))
}

pub(crate) fn private_directory(path: &Path) -> Result<(), String> {
    private_directory_inner(path).map_err(|e| e.to_string())
}
fn private_directory_inner(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Control directory cannot be a reparse point"));
    }
    let name = wide(path.as_os_str())?;
    let mut owner = null_mut();
    let mut security = null_mut();
    let error = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut security,
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    let _security = LocalMemory(security);
    let owner = sid_string(owner)?;
    // Elevated tokens can default newly created objects to a group owner. Accept only
    // this token's own default owner, then explicitly normalize ownership to its user.
    if owner != current_sid()? && owner != token_sid(unsafe { GetCurrentProcess() }, true)? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Control directory must belong to the current user",
        ));
    }
    let private = descriptor()?;
    let mut private_owner = null_mut();
    let mut owner_defaulted = 0;
    if unsafe { GetSecurityDescriptorOwner(private.0, &mut private_owner, &mut owner_defaulted) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut present = 0;
    let mut defaulted = 0;
    let mut acl = null_mut();
    if unsafe { GetSecurityDescriptorDacl(private.0, &mut present, &mut acl, &mut defaulted) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if present == 0 || acl.is_null() {
        return Err(io::Error::other("Missing private control ACL"));
    }
    let error = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            private_owner,
            null_mut(),
            acl,
            null(),
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    Ok(())
}

fn pipe_name(identifier: &str) -> io::Result<Vec<u16>> {
    let identity = format!("{}:{identifier}", current_sid()?);
    wide(std::ffi::OsStr::new(&format!(
        r"\\.\pipe\alwith-extension-{}",
        hex::encode(Sha256::digest(identity.as_bytes()))
    )))
}

// The event and OVERLAPPED allocation outlive every pending kernel access, including cancellation.
struct Operation {
    handle: Arc<OwnedHandle>,
    overlapped: Box<OVERLAPPED>,
    _event: OwnedHandle,
    pending: bool,
}
// OVERLAPPED's pointers reference the owned event and a stable heap allocation, never a thread's stack.
unsafe impl Send for Operation {}
impl Operation {
    fn new(handle: Arc<OwnedHandle>) -> io::Result<Self> {
        let event = owned(unsafe { CreateEventW(null(), 1, 0, null()) })?;
        let overlapped = Box::new(OVERLAPPED { hEvent: event.as_raw_handle(), ..unsafe { std::mem::zeroed() } });
        Ok(Self { handle, overlapped, _event: event, pending: false })
    }
    fn wait(&mut self, timeout: Duration) -> io::Result<u32> {
        let mut transferred = 0;
        let milliseconds =
            timeout.as_millis().saturating_add(u128::from(!timeout.subsec_nanos().is_multiple_of(1_000_000)));
        if unsafe {
            GetOverlappedResultEx(
                self.handle.as_raw_handle(),
                &*self.overlapped,
                &mut transferred,
                milliseconds.min((u32::MAX - 1) as u128) as u32,
                0,
            )
        } != 0
        {
            self.pending = false;
            return Ok(transferred);
        }
        let error = io::Error::last_os_error();
        if matches!(error.raw_os_error().map(|code| code as u32), Some(WAIT_TIMEOUT | ERROR_IO_INCOMPLETE)) {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "Extension pipe deadline exceeded"));
        }
        self.pending = false;
        Err(error)
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if self.pending {
            unsafe {
                // Cancel is a request, not completion. Drain it before releasing buffers/OVERLAPPED.
                CancelIoEx(self.handle.as_raw_handle(), &*self.overlapped);
                let mut transferred = 0;
                GetOverlappedResult(self.handle.as_raw_handle(), &*self.overlapped, &mut transferred, 1);
            }
        }
    }
}

pub(crate) struct Stream {
    handle: Arc<OwnedHandle>,
    server: bool,
    read_timeout: Cell<Duration>,
    write_timeout: Cell<Duration>,
}
impl Stream {
    fn new(handle: Arc<OwnedHandle>, server: bool) -> Self {
        Self {
            handle,
            server,
            read_timeout: Cell::new(Duration::from_secs(5)),
            write_timeout: Cell::new(Duration::from_secs(5)),
        }
    }
    pub(crate) fn try_clone(&self) -> io::Result<Self> {
        Ok(Self {
            handle: self.handle.clone(),
            server: self.server,
            read_timeout: self.read_timeout.clone(),
            write_timeout: self.write_timeout.clone(),
        })
    }
    pub(crate) fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.read_timeout.set(
            timeout
                .filter(|time| !time.is_zero())
                .ok_or_else(|| io::Error::other("A finite read deadline is required"))?,
        );
        Ok(())
    }
    pub(crate) fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.write_timeout.set(
            timeout
                .filter(|time| !time.is_zero())
                .ok_or_else(|| io::Error::other("A finite write deadline is required"))?,
        );
        Ok(())
    }
    fn transfer(&self, buffer: *mut u8, length: usize, write: bool) -> io::Result<usize> {
        let mut operation = Operation::new(self.handle.clone())?;
        let length = length.min(u32::MAX as usize) as u32;
        let success = unsafe {
            if write {
                WriteFile(self.handle.as_raw_handle(), buffer, length, null_mut(), &mut *operation.overlapped)
            } else {
                ReadFile(self.handle.as_raw_handle(), buffer, length, null_mut(), &mut *operation.overlapped)
            }
        };
        if success == 0 {
            let error = io::Error::last_os_error();
            if !write && error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
                return Ok(0);
            }
            if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
                return Err(error);
            }
            operation.pending = true;
        }
        operation
            .wait(if write { self.write_timeout.get() } else { self.read_timeout.get() })
            .map(|count| count as usize)
    }
}
impl Read for Stream {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        self.transfer(buffer.as_mut_ptr(), buffer.len(), false)
    }
}
impl Write for Stream {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        self.transfer(buffer.as_ptr().cast_mut(), buffer.len(), true)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn check_peer(stream: &Stream) -> Result<(), String> {
    let check = || -> io::Result<()> {
        let mut pid = 0;
        let success = unsafe {
            if stream.server {
                GetNamedPipeClientProcessId(stream.handle.as_raw_handle(), &mut pid)
            } else {
                GetNamedPipeServerProcessId(stream.handle.as_raw_handle(), &mut pid)
            }
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        let process = owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) })?;
        if process_sid(process.as_raw_handle())? != current_sid()? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Extension control only accepts the current user",
            ));
        }
        Ok(())
    };
    check().map_err(|e| e.to_string())
}

pub(crate) fn connect(identifier: &str) -> Result<Stream, String> {
    let name = pipe_name(identifier).map_err(|e| e.to_string())?;
    let handle = owned(unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
            null_mut(),
        )
    })
    .map_err(|e| e.to_string())?;
    let stream = Stream::new(Arc::new(handle), false);
    check_peer(&stream)?;
    Ok(stream)
}

pub(crate) struct Listener {
    name: Vec<u16>,
    connection: Operation,
    connected: bool,
}
impl Listener {
    pub(crate) fn bind(_root: &Path, identifier: &str) -> Result<Self, String> {
        let name = pipe_name(identifier).map_err(|e| e.to_string())?;
        let (connection, connected) = Self::instance(&name, true).map_err(|e| e.to_string())?;
        Ok(Self { name, connection, connected })
    }
    fn instance(name: &[u16], first: bool) -> io::Result<(Operation, bool)> {
        let security = descriptor()?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: security.0,
            bInheritHandle: 0,
        };
        let handle = owned(unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { 0 },
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                32768,
                32768,
                0,
                &attributes,
            )
        })?;
        let handle = Arc::new(handle);
        loop {
            let mut connection = Operation::new(handle.clone())?;
            let success = unsafe { ConnectNamedPipe(handle.as_raw_handle(), &mut *connection.overlapped) };
            if success != 0 {
                return Ok((connection, true));
            }
            let error = io::Error::last_os_error();
            match error.raw_os_error().map(|code| code as u32) {
                Some(ERROR_PIPE_CONNECTED) => return Ok((connection, true)),
                Some(ERROR_IO_PENDING) => {
                    connection.pending = true;
                    return Ok((connection, false));
                }
                Some(ERROR_NO_DATA) => {
                    // A client connected and closed before ConnectNamedPipe. Keep the name
                    // reserved and reuse this instance instead of terminating the service.
                    if unsafe { DisconnectNamedPipe(handle.as_raw_handle()) } == 0 {
                        let error = io::Error::last_os_error();
                        if error.raw_os_error() != Some(ERROR_PIPE_NOT_CONNECTED as i32) {
                            return Err(error);
                        }
                    }
                }
                _ => return Err(error),
            }
        }
    }

    pub(crate) fn accept(&mut self) -> io::Result<Stream> {
        if !self.connected {
            match self.connection.wait(Duration::ZERO) {
                Ok(_) => self.connected = true,
                Err(error) if error.kind() == io::ErrorKind::TimedOut => return Err(io::ErrorKind::WouldBlock.into()),
                Err(error)
                    if matches!(
                        error.raw_os_error().map(|code| code as u32),
                        Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA | ERROR_PIPE_NOT_CONNECTED)
                    ) =>
                {
                    let (next, connected) = Self::instance(&self.name, false)?;
                    self.connection = next;
                    self.connected = connected;
                    return Err(io::ErrorKind::WouldBlock.into());
                }
                Err(error) => return Err(error),
            }
        }
        // Keep a listening instance alive so another process cannot take over the name.
        let (next, connected) = Self::instance(&self.name, false)?;
        let previous = std::mem::replace(&mut self.connection, next);
        self.connected = connected;
        Ok(Stream::new(previous.handle.clone(), true))
    }
}

pub(crate) struct DeadlineReader {
    stream: Stream,
    deadline: Instant,
}
impl DeadlineReader {
    pub(crate) fn new(stream: Stream, deadline: Instant) -> io::Result<Self> {
        stream.set_read_timeout(Some(remaining(deadline)?))?;
        Ok(Self { stream, deadline })
    }
}
impl Read for DeadlineReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.stream.set_read_timeout(Some(remaining(self.deadline)?))?;
        self.stream.read(buffer)
    }
}

pub(crate) fn attach_console() -> io::Result<()> {
    // Preserve inherited redirections: AttachConsole can replace the process standard handles.
    let mut saved = Vec::new();
    for kind in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        let handle = unsafe { GetStdHandle(kind) };
        let mut flags = 0;
        if !handle.is_null()
            && handle != INVALID_HANDLE_VALUE
            && unsafe { GetHandleInformation(handle, &mut flags) } != 0
        {
            let copy = unsafe { BorrowedHandle::borrow_raw(handle) }.try_clone_to_owned()?;
            saved.push((kind, copy));
        }
    }
    if saved.iter().any(|(kind, _)| *kind == STD_OUTPUT_HANDLE)
        && saved.iter().any(|(kind, _)| *kind == STD_ERROR_HANDLE)
    {
        return Ok(());
    }
    let attached = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
    let error = io::Error::last_os_error();
    for (kind, handle) in saved {
        if unsafe { SetStdHandle(kind, handle.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _ = handle.into_raw_handle(); // The process now owns this standard handle until exit.
    }
    if attached == 0 && error.raw_os_error() != Some(ERROR_ACCESS_DENIED as i32) {
        return Err(error);
    }
    Ok(())
}

// A closed client has consumed the result (or abandoned it). Never block shutdown indefinitely.
pub(crate) fn wait_for_peer_close(stream: &mut Stream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    match stream.read(&mut [0]) {
        Ok(0) => Ok(()),
        Ok(_) => Err(io::Error::new(io::ErrorKind::InvalidData, "Unexpected bytes after request")),
        Err(error) if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) => Ok(()),
        Err(error) => Err(error),
    }
}

pub(crate) fn is_link(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(test)]
#[path = "../__tests__/extension_transport_windows.rs"]
mod tests;
