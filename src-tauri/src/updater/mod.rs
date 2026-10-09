//! Auto-updater, ported from ALwith Desktop. The ALwith open-source version service supplies
//! signed update metadata to `tauri-plugin-updater`. The service owns the
//! state machine; the plugin only checks, downloads and installs. A downloaded archive survives
//! restarts on disk and is re-verified (minisign + remote identity) before it is offered again.

use tauri3_specta::Event;

pub mod commands;
pub mod persist;
pub mod scheduler;
pub mod state;

use crate::updater::state::{State, UpdateInfo};
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use std::future::Future;
use std::pin::Pin;
use std::sync::RwLock;

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

fn is_newer_version(candidate: &str, current: &str) -> Result<bool, String> {
    let candidate = Version::parse(candidate.trim_start_matches('v')).map_err(|error| error.to_string())?;
    let current = Version::parse(current.trim_start_matches('v')).map_err(|error| error.to_string())?;
    Ok(candidate > current)
}

pub fn is_same_release(remote: Option<&UpdateInfo>, ready: &UpdateInfo) -> bool {
    remote.is_some_and(|remote| remote.version == ready.version && remote.signature == ready.signature)
}

pub struct UpdaterService {
    state: RwLock<State>,
    notify_listeners: Box<dyn Fn(&State) + Send + Sync>,
}

impl UpdaterService {
    pub fn new(notify: impl Fn(&State) + Send + Sync + 'static) -> Self {
        Self { state: RwLock::new(State::Uninitialized), notify_listeners: Box::new(notify) }
    }

    pub fn state(&self) -> State {
        self.state.read().unwrap().clone()
    }

    pub fn set_state(&self, new_state: State) {
        {
            let mut current = self.state.write().unwrap();
            *current = new_state.clone();
        }
        (self.notify_listeners)(&new_state);
    }

    /// Store without notifying: a hit goes straight to `Downloading`, so the webview never
    /// sees `AvailableForDownload` flash by.
    fn set_state_silent(&self, new_state: State) {
        let mut current = self.state.write().unwrap();
        *current = new_state;
    }
}

pub trait UpdateChecker: Send + Sync {
    fn check(&self) -> Result<Option<UpdateInfo>, String>;
}

impl UpdaterService {
    pub fn check_for_updates(&self, checker: &dyn UpdateChecker) {
        if !matches!(self.state(), State::Idle) {
            return;
        }
        self.set_state(State::CheckingForUpdates);
        match checker.check() {
            Ok(Some(update)) => self.set_state_silent(State::AvailableForDownload { update }),
            Ok(None) => self.set_state(State::Idle),
            Err(error) => {
                log::warn!("automatic update check failed: {error}");
                self.set_state(State::Idle);
            }
        }
    }
}

pub type ProgressFn = Box<dyn Fn(u64, Option<u64>) + Send + Sync>;

pub trait Downloader: Send + Sync {
    fn download<'a>(
        &'a self, update: &'a UpdateInfo, on_progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Vec<u8>, String>>;
}

impl UpdaterService {
    /// Downloads into `<updater_dir>/<filename>` and records it as ready in the state file.
    pub async fn download_update(
        self: &std::sync::Arc<Self>, downloader: &dyn Downloader, updater_dir: &std::path::Path,
    ) -> Result<(), String> {
        let update = match self.state() {
            State::AvailableForDownload { update } => update,
            _ => return Err("not in AvailableForDownload state".into()),
        };

        self.set_state(State::Downloading {
            update: update.clone(),
            downloaded_bytes: Some(0),
            total_bytes: update.content_length,
        });

        // Progress is throttled to about 1% (at least 64KB) so the IPC channel is not flooded;
        // the total prefers the HTTP Content-Length the plugin reports.
        let svc = self.clone();
        let progress_update = update.clone();
        let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let last_emit = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let on_progress: ProgressFn = Box::new(move |chunk, total| {
            use std::sync::atomic::Ordering;
            let now = downloaded.fetch_add(chunk, Ordering::Relaxed) + chunk;
            let total = total.or(progress_update.content_length);
            let threshold = total.map(|t| (t / 100).max(65_536)).unwrap_or(262_144);
            let prev = last_emit.load(Ordering::Relaxed);
            let done = total.is_some_and(|t| now >= t);
            if now.saturating_sub(prev) >= threshold || done {
                last_emit.store(now, Ordering::Relaxed);
                svc.set_state(State::Downloading {
                    update: progress_update.clone(),
                    downloaded_bytes: Some(now),
                    total_bytes: total,
                });
            }
        });

        let bytes = downloader.download(&update, on_progress).await?;

        std::fs::create_dir_all(updater_dir).map_err(|e| e.to_string())?;
        std::fs::write(updater_dir.join(&update.filename), &bytes).map_err(|e| e.to_string())?;
        persist::save(&updater_dir.join(persist::STATE_FILE), &persist::PersistedState { ready: Some(update.clone()) })
            .map_err(|e| e.to_string())?;

        self.set_state(State::Ready { update });
        Ok(())
    }

    /// Every bundle this app ships (macOS .app.tar.gz, Windows NSIS, Linux AppImage) is
    /// auto-downloaded; the user only confirms the relaunch. A failed download must go back
    /// to `Idle`, otherwise the hourly check (which only runs from `Idle`) is stuck for good.
    pub async fn autodownload_if_available(
        self: &std::sync::Arc<Self>, downloader: &dyn Downloader, updater_dir: &std::path::Path,
    ) {
        if !matches!(self.state(), State::AvailableForDownload { .. }) {
            return;
        }
        if let Err(error) = self.download_update(downloader, updater_dir).await {
            log::warn!("automatic update download failed: {error}");
            self.set_state(State::Idle);
        }
    }
}

pub trait Installer: Send + Sync {
    /// `Ok` means the install was started; `Err` restores `Ready` so the user can retry.
    fn install<'a>(&'a self, update: &'a UpdateInfo, bytes: Vec<u8>) -> BoxFuture<'a, Result<(), String>>;
    /// Windows NSIS relaunches itself (`/R`); every other platform needs an explicit restart.
    fn needs_explicit_restart(&self) -> bool;
    fn restart(&self) -> BoxFuture<'_, Result<(), String>>;
}

impl UpdaterService {
    pub async fn install_and_relaunch(
        &self, installer: &dyn Installer, updater_dir: &std::path::Path,
    ) -> Result<(), String> {
        let (update, ready_snapshot) = match self.state() {
            ref s @ State::Ready { ref update } => (update.clone(), s.clone()),
            _ => return Err("not in Ready state".into()),
        };

        let bytes = std::fs::read(updater_dir.join(&update.filename)).map_err(|e| e.to_string())?;
        self.set_state(State::Restarting { update: update.clone() });

        if let Err(e) = installer.install(&update, bytes).await {
            self.set_state(ready_snapshot);
            return Err(e);
        }

        persist::clear_or_log(updater_dir, Some(&update.filename));

        if installer.needs_explicit_restart()
            && let Err(e) = installer.restart().await
        {
            self.set_state(State::Idle);
            return Err(e);
        }
        Ok(())
    }
}

pub trait SignatureVerifier: Send + Sync {
    fn verify(&self, bytes: &[u8], signature: &str) -> Result<(), String>;
}

impl UpdaterService {
    /// Startup recovery: a downloaded archive is offered again only when it is newer than the
    /// running version, its minisign signature checks out, and the remote still publishes the
    /// same release (a network error keeps the verified archive).
    pub async fn init_recover(
        &self, updater_dir: &std::path::Path, current_version: &str, verifier: &dyn SignatureVerifier,
        checker: &dyn UpdateChecker,
    ) {
        let persisted = persist::load(&updater_dir.join(persist::STATE_FILE));
        let Some(ready) = persisted.ready else {
            self.set_state(State::idle());
            return;
        };
        let discard = |this: &Self| {
            persist::clear_or_log(updater_dir, Some(&ready.filename));
            this.set_state(State::idle());
        };

        if !is_newer_version(&ready.version, current_version).unwrap_or(false) {
            return discard(self);
        }
        let Ok(bytes) = std::fs::read(updater_dir.join(&ready.filename)) else {
            return discard(self);
        };
        if verifier.verify(&bytes, &ready.signature).is_err() {
            return discard(self);
        }
        match checker.check() {
            Ok(remote) if is_same_release(remote.as_ref(), &ready) => self.set_state(State::Ready { update: ready }),
            Ok(_) => discard(self),
            Err(error) => {
                log::warn!("cached update release revalidation failed: {error}");
                self.set_state(State::Ready { update: ready });
            }
        }
    }
}

// ── tauri-plugin-updater adapters ───────────────────────────────────────────

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

pub struct PluginChecker {
    app: AppHandle,
}

impl PluginChecker {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl UpdateChecker for PluginChecker {
    fn check(&self) -> Result<Option<UpdateInfo>, String> {
        let app = self.app.clone();
        let result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async move {
                app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())
            })
        })?;
        let Some(update) = result else {
            return Ok(None);
        };
        let filename = persist::filename_from_url(update.download_url.as_ref())
            .ok_or_else(|| "cannot extract filename from download URL".to_string())?;
        Ok(Some(UpdateInfo {
            version: update.version.clone(),
            filename,
            signature: update.signature.clone(),
            content_length: None,
        }))
    }
}

pub struct PluginDownloader {
    app: AppHandle,
}

impl PluginDownloader {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Downloader for PluginDownloader {
    fn download<'a>(
        &'a self, update: &'a UpdateInfo, on_progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Vec<u8>, String>> {
        Box::pin(async move {
            let updater = self.app.updater().map_err(|e| e.to_string())?;
            let plugin_update =
                updater.check().await.map_err(|e| e.to_string())?.ok_or_else(|| "no update available".to_string())?;
            if plugin_update.version != update.version || plugin_update.signature != update.signature {
                return Err("update changed between check and download".to_string());
            }
            plugin_update
                .download(|chunk, total| on_progress(chunk as u64, total), || {})
                .await
                .map_err(|e| e.to_string())
        })
    }
}

pub struct PluginInstaller {
    app: AppHandle,
}

impl PluginInstaller {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Installer for PluginInstaller {
    fn install<'a>(&'a self, update: &'a UpdateInfo, bytes: Vec<u8>) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            let updater = self.app.updater().map_err(|e| e.to_string())?;
            let plugin_update =
                updater.check().await.map_err(|e| e.to_string())?.ok_or_else(|| "no update available".to_string())?;
            if plugin_update.version != update.version || plugin_update.signature != update.signature {
                return Err("downloaded update is no longer the current release".to_string());
            }
            plugin_update.install(bytes).map_err(|e| e.to_string())
        })
    }

    fn needs_explicit_restart(&self) -> bool {
        !cfg!(target_os = "windows")
    }

    fn restart(&self) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async move { self.app.restart() })
    }
}

pub struct MinisignVerifier {
    public_key: String,
}

impl MinisignVerifier {
    pub fn new(public_key: String) -> Self {
        Self { public_key }
    }
}

impl SignatureVerifier for MinisignVerifier {
    fn verify(&self, bytes: &[u8], signature: &str) -> Result<(), String> {
        let public_key =
            base64::engine::general_purpose::STANDARD.decode(&self.public_key).map_err(|error| error.to_string())?;
        let public_key = std::str::from_utf8(&public_key).map_err(|error| error.to_string())?;
        let public_key = PublicKey::decode(public_key).map_err(|error| error.to_string())?;
        let signature =
            base64::engine::general_purpose::STANDARD.decode(signature).map_err(|error| error.to_string())?;
        let signature = std::str::from_utf8(&signature).map_err(|error| error.to_string())?;
        let signature = Signature::decode(signature).map_err(|error| error.to_string())?;
        public_key.verify(bytes, &signature, true).map_err(|error| error.to_string())
    }
}

/// Wires the service into the app: state changes reach the webview as `updater:state`; startup
/// recovers a downloaded archive, then the 30s/1h check loop and the 5-minute overwrite check run
/// for the life of the process. Missing `plugins.updater.endpoints` disables the whole feature.
pub fn init(app: &tauri::App) {
    use tauri::Manager;

    let app_handle = app.handle().clone();
    let svc = std::sync::Arc::new(UpdaterService::new(move |state| {
        let _ = state.emit(&app_handle);
    }));
    app.manage(svc.clone());

    let updater_config = app.config().plugins.0.get("updater").cloned();
    let endpoints_ok = updater_config
        .as_ref()
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .is_some_and(|endpoints| !endpoints.is_empty());
    let public_key = updater_config
        .as_ref()
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    let Some(public_key) = public_key.filter(|_| endpoints_ok) else {
        svc.set_state(State::Disabled { reason: state::DisablementReason::InvalidConfiguration });
        return;
    };

    let app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let Ok(updater_dir) = commands::updater_dir(&app) else {
            return;
        };
        let checker = PluginChecker::new(app.clone());
        svc.init_recover(&updater_dir, env!("CARGO_PKG_VERSION"), &MinisignVerifier::new(public_key), &checker).await;

        let svc_overwrite = svc.clone();
        let app_overwrite = app.clone();
        tauri::async_runtime::spawn(async move {
            scheduler::schedule_overwrite_check(
                scheduler::OVERWRITE_CHECK_INTERVAL,
                || matches!(svc_overwrite.state(), State::Ready { .. }),
                || {
                    let svc = svc_overwrite.clone();
                    let app = app_overwrite.clone();
                    async move {
                        let State::Ready { update: ready_update } = svc.state() else {
                            return;
                        };
                        let checker = PluginChecker::new(app.clone());
                        let latest = scheduler::is_latest_with_timeout(scheduler::OVERWRITE_CHECK_TIMEOUT, || async {
                            checker.check().map(|remote| is_same_release(remote.as_ref(), &ready_update))
                        })
                        .await;
                        if latest == Some(false) {
                            let Ok(updater_dir) = commands::updater_dir(&app) else {
                                return;
                            };
                            persist::clear_or_log(&updater_dir, Some(&ready_update.filename));
                            svc.set_state(State::idle());
                            commands::check_and_autodownload(app.clone(), svc.clone()).await;
                        }
                    }
                },
            )
            .await;
        });

        scheduler::schedule_check_loop(scheduler::FIRST_CHECK_DELAY, scheduler::CHECK_INTERVAL, move || {
            let svc = svc.clone();
            let app = app.clone();
            async move { commands::check_and_autodownload(app, svc).await }
        })
        .await;
    });
}

#[cfg(test)]
pub(crate) mod test_support {
    /// A unique scratch directory removed on drop (no `tempfile` dependency).
    pub struct TempDir(std::path::PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            let path = std::env::temp_dir().join(format!("alwith-u-updater-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        pub fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::TempDir;
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    struct MockChecker(Result<Option<UpdateInfo>, String>);
    impl UpdateChecker for MockChecker {
        fn check(&self) -> Result<Option<UpdateInfo>, String> {
            self.0.clone()
        }
    }

    struct MockDownloader(Result<Vec<u8>, String>);
    impl Downloader for MockDownloader {
        fn download<'a>(&'a self, _: &'a UpdateInfo, _: ProgressFn) -> BoxFuture<'a, Result<Vec<u8>, String>> {
            let result = self.0.clone();
            Box::pin(async move { result })
        }
    }

    struct MockInstaller {
        install_result: Result<(), String>,
        needs_restart: bool,
        restart_called: Arc<AtomicBool>,
    }
    impl Installer for MockInstaller {
        fn install<'a>(&'a self, _: &'a UpdateInfo, _: Vec<u8>) -> BoxFuture<'a, Result<(), String>> {
            let result = self.install_result.clone();
            Box::pin(async move { result })
        }
        fn needs_explicit_restart(&self) -> bool {
            self.needs_restart
        }
        fn restart(&self) -> BoxFuture<'_, Result<(), String>> {
            self.restart_called.store(true, Ordering::Relaxed);
            Box::pin(async { Ok(()) })
        }
    }

    struct MockVerifier(bool);
    impl SignatureVerifier for MockVerifier {
        fn verify(&self, _: &[u8], _: &str) -> Result<(), String> {
            if self.0 { Ok(()) } else { Err("bad sig".into()) }
        }
    }

    fn recording_service() -> (Arc<UpdaterService>, Arc<Mutex<Vec<State>>>) {
        let emitted = Arc::new(Mutex::new(Vec::<State>::new()));
        let sink = emitted.clone();
        let svc = Arc::new(UpdaterService::new(move |s| sink.lock().unwrap().push(s.clone())));
        (svc, emitted)
    }

    fn sample_update(version: &str) -> UpdateInfo {
        UpdateInfo {
            version: version.into(),
            filename: format!("alwith-u-{version}.app.tar.gz"),
            signature: "sig".into(),
            content_length: Some(5),
        }
    }

    fn ready_on_disk(version: &str) -> (Arc<UpdaterService>, TempDir, UpdateInfo) {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        let update = sample_update(version);
        let tmp = TempDir::new();
        std::fs::write(tmp.path().join(&update.filename), b"hello").unwrap();
        persist::save(&tmp.path().join(persist::STATE_FILE), &persist::PersistedState { ready: Some(update.clone()) })
            .unwrap();
        (svc, tmp, update)
    }

    // ── check ──

    #[test]
    fn check_hit_is_stored_silently_as_available() {
        let (svc, emitted) = recording_service();
        svc.set_state(State::idle());
        emitted.lock().unwrap().clear();
        svc.check_for_updates(&MockChecker(Ok(Some(sample_update("0.2.0")))));
        assert!(matches!(svc.state(), State::AvailableForDownload { .. }));
        assert!(!emitted.lock().unwrap().iter().any(|s| matches!(s, State::AvailableForDownload { .. })));
    }

    #[test]
    fn check_miss_or_error_returns_to_idle_and_non_idle_is_noop() {
        let (svc, _) = recording_service();
        svc.set_state(State::idle());
        svc.check_for_updates(&MockChecker(Ok(None)));
        assert!(matches!(svc.state(), State::Idle));
        svc.check_for_updates(&MockChecker(Err("net down".into())));
        assert!(matches!(svc.state(), State::Idle));
        svc.set_state(State::Downloading { update: sample_update("0.2.0"), downloaded_bytes: None, total_bytes: None });
        svc.check_for_updates(&MockChecker(Ok(Some(sample_update("0.3.0")))));
        assert!(matches!(svc.state(), State::Downloading { .. }));
    }

    // ── download ──

    #[tokio::test]
    async fn download_success_transitions_to_ready_and_persists() {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        let update = sample_update("0.2.0");
        svc.set_state(State::AvailableForDownload { update: update.clone() });
        let tmp = TempDir::new();
        svc.download_update(&MockDownloader(Ok(b"hello".to_vec())), tmp.path()).await.unwrap();
        assert!(matches!(svc.state(), State::Ready { .. }));
        assert_eq!(std::fs::read(tmp.path().join(&update.filename)).unwrap(), b"hello");
        assert_eq!(persist::load(&tmp.path().join(persist::STATE_FILE)).ready.unwrap().version, "0.2.0");
    }

    #[tokio::test]
    async fn download_failure_persists_nothing_and_autodownload_resets_to_idle() {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        svc.set_state(State::AvailableForDownload { update: sample_update("0.2.0") });
        let tmp = TempDir::new();
        assert!(svc.download_update(&MockDownloader(Err("net".into())), tmp.path()).await.is_err());
        assert!(!tmp.path().join(persist::STATE_FILE).exists());
        svc.set_state(State::AvailableForDownload { update: sample_update("0.2.0") });
        svc.autodownload_if_available(&MockDownloader(Err("net".into())), tmp.path()).await;
        assert!(matches!(svc.state(), State::Idle));
    }

    #[tokio::test]
    async fn download_from_wrong_state_errors_and_autodownload_is_noop() {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        svc.set_state(State::idle());
        let tmp = TempDir::new();
        assert!(svc.download_update(&MockDownloader(Ok(vec![])), tmp.path()).await.is_err());
        svc.autodownload_if_available(&MockDownloader(Ok(b"x".to_vec())), tmp.path()).await;
        assert!(matches!(svc.state(), State::Idle));
    }

    #[tokio::test]
    async fn download_emits_monotonic_progress_with_total_from_callback() {
        struct ProgressDownloader;
        impl Downloader for ProgressDownloader {
            fn download<'a>(
                &'a self, _: &'a UpdateInfo, on_progress: ProgressFn,
            ) -> BoxFuture<'a, Result<Vec<u8>, String>> {
                Box::pin(async move {
                    let total = 10_000_000u64;
                    for _ in 0..50 {
                        on_progress(200_000, Some(total));
                    }
                    Ok(vec![0u8; total as usize])
                })
            }
        }
        let (svc, emitted) = recording_service();
        let mut update = sample_update("0.2.0");
        update.content_length = None;
        svc.set_state(State::AvailableForDownload { update });
        let tmp = TempDir::new();
        svc.download_update(&ProgressDownloader, tmp.path()).await.unwrap();
        let progress: Vec<u64> = emitted
            .lock()
            .unwrap()
            .iter()
            .filter_map(|s| match s {
                State::Downloading { downloaded_bytes, total_bytes, .. } => {
                    if downloaded_bytes.unwrap_or(0) > 0 {
                        assert_eq!(*total_bytes, Some(10_000_000));
                    }
                    *downloaded_bytes
                }
                _ => None,
            })
            .collect();
        assert!(progress.len() >= 2);
        assert_eq!(progress.first(), Some(&0));
        assert!(progress.is_sorted());
        assert_eq!(progress.last(), Some(&10_000_000));
    }

    // ── install ──

    #[tokio::test]
    async fn install_success_restarts_when_needed_and_clears_cache() {
        let (svc, tmp, update) = ready_on_disk("0.2.0");
        svc.set_state(State::Ready { update: update.clone() });
        let restart_called = Arc::new(AtomicBool::new(false));
        let installer =
            MockInstaller { install_result: Ok(()), needs_restart: true, restart_called: restart_called.clone() };
        svc.install_and_relaunch(&installer, tmp.path()).await.unwrap();
        assert!(restart_called.load(Ordering::Relaxed));
        assert!(!tmp.path().join(&update.filename).exists());
        assert!(!tmp.path().join(persist::STATE_FILE).exists());
    }

    #[tokio::test]
    async fn install_success_skips_restart_on_windows_like() {
        let (svc, tmp, update) = ready_on_disk("0.2.0");
        svc.set_state(State::Ready { update });
        let restart_called = Arc::new(AtomicBool::new(false));
        let installer =
            MockInstaller { install_result: Ok(()), needs_restart: false, restart_called: restart_called.clone() };
        svc.install_and_relaunch(&installer, tmp.path()).await.unwrap();
        assert!(!restart_called.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn install_failure_restores_ready_and_keeps_archive() {
        let (svc, tmp, update) = ready_on_disk("0.2.0");
        svc.set_state(State::Ready { update: update.clone() });
        let installer = MockInstaller {
            install_result: Err("bad".into()),
            needs_restart: true,
            restart_called: Arc::new(AtomicBool::new(false)),
        };
        assert!(svc.install_and_relaunch(&installer, tmp.path()).await.is_err());
        assert!(matches!(svc.state(), State::Ready { .. }));
        assert!(tmp.path().join(&update.filename).exists());
    }

    #[tokio::test]
    async fn install_from_wrong_state_errors() {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        svc.set_state(State::idle());
        let installer = MockInstaller {
            install_result: Ok(()),
            needs_restart: false,
            restart_called: Arc::new(AtomicBool::new(false)),
        };
        let tmp = TempDir::new();
        assert!(svc.install_and_relaunch(&installer, tmp.path()).await.is_err());
    }

    // ── recover ──

    #[tokio::test]
    async fn recover_no_state_goes_idle() {
        let svc = Arc::new(UpdaterService::new(|_| {}));
        let tmp = TempDir::new();
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Ok(None))).await;
        assert!(matches!(svc.state(), State::Idle));
    }

    #[tokio::test]
    async fn recover_valid_archive_matching_remote_goes_ready() {
        let (svc, tmp, update) = ready_on_disk("1.1.0");
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Ok(Some(update)))).await;
        assert!(matches!(svc.state(), State::Ready { update } if update.version == "1.1.0"));
    }

    #[tokio::test]
    async fn recover_network_error_keeps_verified_archive_ready() {
        let (svc, tmp, _) = ready_on_disk("1.1.0");
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Err("offline".into()))).await;
        assert!(matches!(svc.state(), State::Ready { .. }));
        assert!(tmp.path().join(persist::STATE_FILE).exists());
    }

    #[tokio::test]
    async fn recover_discards_bad_signature_missing_archive_and_changed_remote() {
        let (svc, tmp, update) = ready_on_disk("1.1.0");
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(false), &MockChecker(Ok(Some(update)))).await;
        assert!(matches!(svc.state(), State::Idle));
        assert!(!tmp.path().join(persist::STATE_FILE).exists());

        let (svc, tmp, update) = ready_on_disk("1.1.0");
        std::fs::remove_file(tmp.path().join(&update.filename)).unwrap();
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Ok(Some(update)))).await;
        assert!(matches!(svc.state(), State::Idle));

        let (svc, tmp, _) = ready_on_disk("1.1.0");
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Ok(Some(sample_update("1.2.0")))))
            .await;
        assert!(matches!(svc.state(), State::Idle));

        let (svc, tmp, _) = ready_on_disk("28.0.0");
        svc.init_recover(tmp.path(), "26.7.31", &MockVerifier(true), &MockChecker(Ok(None))).await;
        assert!(matches!(svc.state(), State::Idle));
        assert!(!tmp.path().join(persist::STATE_FILE).exists());

        let (svc, tmp, mut update) = ready_on_disk("1.1.0");
        update.signature = "replacement".into();
        svc.init_recover(tmp.path(), "1.0.0", &MockVerifier(true), &MockChecker(Ok(Some(update)))).await;
        assert!(matches!(svc.state(), State::Idle));
    }

    #[tokio::test]
    async fn recover_discards_archives_not_newer_than_running_or_unparseable() {
        for (cached, current) in [("1.1.0", "1.1.0"), ("1.1.0", "1.2.0"), ("invalid-version", "1.0.0")] {
            let (svc, tmp, update) = ready_on_disk(cached);
            svc.init_recover(tmp.path(), current, &MockVerifier(true), &MockChecker(Ok(Some(update)))).await;
            assert!(matches!(svc.state(), State::Idle), "{cached} vs {current}");
            assert!(!tmp.path().join(persist::STATE_FILE).exists());
        }
    }

    #[test]
    fn set_state_emits_to_listener() {
        let (svc, emitted) = recording_service();
        svc.set_state(State::idle());
        assert_eq!(emitted.lock().unwrap().len(), 1);
    }
}
