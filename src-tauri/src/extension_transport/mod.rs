//! Platform IPC; installation and durable receipts remain in the shared control service.
use std::{
    io,
    time::{Duration, Instant},
};
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub(crate) use macos::*;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use windows::*;

pub(crate) fn remaining(deadline: Instant) -> io::Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "Extension request deadline exceeded"))
}

#[cfg(test)]
#[path = "../__tests__/extension_transport.rs"]
pub(crate) mod tests;
