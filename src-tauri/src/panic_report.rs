use std::{
    backtrace::Backtrace,
    fs::OpenOptions,
    io::{self, Write},
    path::{Path, PathBuf},
};

fn append_report(path: &Path, report: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(report.as_bytes())?;
    file.sync_all()
}

pub fn install(path: PathBuf) {
    // Diagnostics must not prevent startup; the hook retries if the destination recovers.
    if let Err(error) = append_report(&path, "") {
        log::warn!("Cannot initialize panic report at {}: {error}", path.display());
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let report = format!(
            "\nALwith U {} | {:?} | thread {:?} {:?}\n{info}\n{}\n",
            env!("CARGO_PKG_VERSION"),
            std::time::SystemTime::now(),
            thread.name(),
            thread.id(),
            Backtrace::force_capture()
        );
        // Write directly: a panic may already hold a logger lock, and abort never runs cleanup.
        if let Err(error) = append_report(&path, &report) {
            eprintln!("Cannot persist panic report to {}: {error}", path.display());
        }
        previous(info);
    }));
}

#[cfg(test)]
#[path = "__tests__/panic_report.rs"]
mod tests;
