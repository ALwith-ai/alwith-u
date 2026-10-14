//! Awaitable native-window decoration support for Tauri v2.
//!
//! Register [`init`] or a configured [`DecorationPluginBuilder`] before
//! creating webviews, then use [`WebviewWindowExt`] on the native window's
//! primary same-label webview.
#![warn(missing_docs)]

#[cfg(target_os = "windows")]
use crate::lifecycle::GeometryDecision;
use crate::{
    dispatcher::{dispatch, DispatchError},
    frontend::{
        FrontendOptions, FrontendSnapGeometryUpdate, GeometryReceipt, Platform, PreparedFrontend,
        SnapGeometryUpdate,
    },
    lifecycle::{
        ActivationRequest, AttemptId, DecorationState, DocumentBootDecision, DocumentReadyDecision,
        FrontendTarget, NavigationRequest, ReadinessChallenge, ReadinessDecision, RecoveryClaim,
        RecoveryRequest,
    },
};
#[cfg(target_os = "linux")]
use gtk::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    future::Future,
    marker::PhantomData,
    panic::{catch_unwind, AssertUnwindSafe},
    time::Duration,
};
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "windows")]
use tauri::Error;
use tauri::{Manager, RunEvent, Runtime, WebviewWindow, WindowEvent};

#[cfg(test)]
use crate::frontend::WindowControlPolicy;

mod dispatcher;
mod frontend;
mod lifecycle;
mod native;
mod protocol;

#[cfg(target_os = "macos")]
mod traffic;

#[cfg(any(target_os = "linux", test))]
mod linux;

#[cfg(target_os = "windows")]
mod snap;

#[cfg(any(target_os = "windows", test))]
mod snap_state;

#[cfg(any(target_os = "macos", test))]
mod traffic_state;

const DEFAULT_ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
/// The lifecycle state of a window's custom decoration.
pub enum DecorationStatus {
    /// The operating system frame is active, or no activation was requested.
    Native,
    /// Frontend preparation or native application is in progress.
    Preparing,
    /// The exact prepared frontend document owns the active decoration.
    Active,
    /// The plugin is restoring a usable native frame.
    Recovering,
    /// Activation or restoration failed.
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
/// Stable categories for decoration failures.
pub enum DecorationErrorKind {
    /// The plugin was not registered before the operation.
    NotInitialized,
    /// The frontend runtime could not prepare the decoration.
    FrontendUnavailable,
    /// The embedded stylesheet could not be loaded or validated.
    StylesheetLoad,
    /// Activation exceeded the configured lifecycle deadline.
    ActivationTimeout,
    /// Applying a native decoration or helper failed.
    NativeApply,
    /// Restoring the operating system frame failed.
    NativeRestore,
    /// Work could not be scheduled on the application main thread.
    MainThreadSchedule,
    /// A queued main-thread operation exceeded its deadline before it started.
    MainThreadTimeout,
    /// A main-thread operation panicked and was contained.
    MainThreadPanic,
    /// The current platform, backend, or feature configuration is unsupported.
    UnsupportedPlatform,
    /// The exact frontend target is not authorized for the requested action.
    ActionDenied,
    /// A newer lifecycle operation superseded this request.
    Cancelled,
    /// The target native window was destroyed.
    WindowDestroyed,
    /// The application exited before the operation completed.
    ApplicationShutdown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
/// An error returned by an awaitable decoration operation.
pub struct DecorationError {
    kind: DecorationErrorKind,
    detail: String,
}

impl DecorationError {
    /// Returns the stable failure category.
    pub fn kind(&self) -> DecorationErrorKind {
        self.kind
    }

    /// Returns the diagnostic detail associated with the failure.
    pub fn detail(&self) -> &str {
        &self.detail
    }

    fn new(kind: DecorationErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }

    fn not_initialized(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::NotInitialized, detail)
    }

    fn frontend(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::FrontendUnavailable, detail)
    }

    fn stylesheet(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::StylesheetLoad, detail)
    }

    fn activation_timeout(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::ActivationTimeout, detail)
    }

    fn native_apply(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::NativeApply, detail)
    }

    fn native_restore(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::NativeRestore, detail)
    }

    #[cfg(any(
        target_os = "linux",
        all(target_os = "macos", not(feature = "macos-transparency"))
    ))]
    pub(crate) fn unsupported_platform(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::UnsupportedPlatform, detail)
    }

    fn action_denied(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::ActionDenied, detail)
    }

    fn cancelled(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::Cancelled, detail)
    }

    fn window_destroyed(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::WindowDestroyed, detail)
    }

    fn application_shutdown(detail: impl Into<String>) -> Self {
        Self::new(DecorationErrorKind::ApplicationShutdown, detail)
    }
}

impl fmt::Display for DecorationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.detail)
    }
}

impl std::error::Error for DecorationError {}

/// Configures and builds the decoration plugin.
pub struct DecorationPluginBuilder<R: Runtime> {
    activation_timeout: Duration,
    runtime: PhantomData<R>,
}

impl<R: Runtime> Default for DecorationPluginBuilder<R> {
    fn default() -> Self {
        Self {
            activation_timeout: DEFAULT_ACTIVATION_TIMEOUT,
            runtime: PhantomData,
        }
    }
}

impl<R: Runtime> DecorationPluginBuilder<R> {
    /// Sets the activation and queued main-thread operation deadline.
    ///
    /// # Panics
    ///
    /// Panics when `timeout` is zero.
    pub fn activation_timeout(mut self, timeout: Duration) -> Self {
        assert!(
            !timeout.is_zero(),
            "decoration activation timeout must be nonzero"
        );
        self.activation_timeout = timeout;
        self
    }

    /// Builds the Tauri plugin with the configured policy.
    pub fn build(self) -> TauriPlugin<R> {
        build_plugin(self.activation_timeout)
    }
}

/// Returns a builder using the five-second activation deadline.
pub fn builder<R: Runtime>() -> DecorationPluginBuilder<R> {
    DecorationPluginBuilder::default()
}

/// Native decoration extensions for a Tauri [`WebviewWindow`].
///
/// A decorated native window must use its primary, same-label webview for the
/// embedded decoration runtime. Sibling webviews and remote content are not
/// part of the supported command boundary.
pub trait WebviewWindowExt<R: Runtime> {
    /// Prepares the current document, applies native decoration state, and waits for commit.
    ///
    /// Concurrent calls join the same activation. On failure, the future
    /// resolves only after the recovery owner has attempted native restoration.
    fn activate_decoration(&self) -> impl Future<Output = Result<(), DecorationError>> + Send;
    /// Cancels pending or active decoration and waits for native restoration.
    ///
    /// Concurrent restoration calls join one uniquely owned recovery.
    fn restore_decoration(&self) -> impl Future<Output = Result<(), DecorationError>> + Send;
    /// Returns the current lifecycle state without exposing frontend target tokens.
    fn decoration_status(&self) -> Result<DecorationStatus, DecorationError>;

    /// Positions native AppKit traffic lights and waits for completion.
    #[cfg(target_os = "macos")]
    fn set_traffic_lights_inset(
        &self,
        x: f32,
        y: f32,
    ) -> impl Future<Output = Result<(), DecorationError>> + Send;
}

#[cfg(target_os = "macos")]
/// Awaitable optional macOS window effects outside the core decoration lifecycle.
pub trait MacOsWindowEffectsExt<R: Runtime> {
    /// Makes the live WKWebView and NSWindow transparent.
    ///
    /// This requires the `macos-transparency` feature, which uses a private
    /// Wry macOS API and is unsuitable for App Store distribution.
    fn make_transparent(&self) -> impl Future<Output = Result<(), DecorationError>> + Send;
    /// Sets the signed AppKit `NSWindowLevel` and waits for completion.
    fn set_window_level(
        &self,
        level: i32,
    ) -> impl Future<Output = Result<(), DecorationError>> + Send;
}

impl<R: Runtime> WebviewWindowExt<R> for WebviewWindow<R> {
    fn activate_decoration(&self) -> impl Future<Output = Result<(), DecorationError>> + Send {
        activate_decoration(self.clone())
    }

    fn restore_decoration(&self) -> impl Future<Output = Result<(), DecorationError>> + Send {
        restore_decoration(self.clone())
    }

    fn decoration_status(&self) -> Result<DecorationStatus, DecorationError> {
        decoration_state_typed(self).map(|state| state.status(self.label()))
    }

    /// Position the macOS traffic-light buttons (close/minimize/zoom).
    ///
    /// The two parameters control different things because the buttons are
    /// native OS controls positioned within an AppKit titlebar container:
    ///
    /// - `x` — **horizontal position**, in points from the left edge of the
    ///   window's content. The first button is placed at `x`, and the other
    ///   buttons preserve AppKit's measured native spacing relative to it.
    ///   This is a direct offset.
    ///
    /// - `y` — **titlebar container height**, in points, added on top of the
    ///   button height (`container_height = button_height + y`). The buttons
    ///   are then **vertically centered** within that container. This is an
    ///   *indirect* control: increasing `y` makes the container taller and
    ///   pushes the centered buttons down from the window's top edge;
    ///   decreasing it pulls them up. It does *not* offset the buttons off
    ///   center within the container.
    ///
    /// As a side effect, this method exposes the right edge of the last button
    /// to the webview as `--tauri-plugin-decoration-left-clearance` so app
    /// content can avoid overlapping the cluster.
    ///
    /// This is only available on macOS.
    #[cfg(target_os = "macos")]
    fn set_traffic_lights_inset(
        &self,
        x: f32,
        y: f32,
    ) -> impl Future<Output = Result<(), DecorationError>> + Send {
        let window = self.clone();
        async move {
            let deadline = decoration_state_typed(&window)?.activation_timeout();
            let dispatch_window = window.clone();
            dispatch_webview(&window, deadline, "traffic-lights-inset", move || {
                traffic::set_inset(&dispatch_window, x.into(), y.into())
                    .map_err(|error| DecorationError::native_apply(error.to_string()))
            })
            .await
        }
    }
}

#[cfg(target_os = "macos")]
impl<R: Runtime> MacOsWindowEffectsExt<R> for WebviewWindow<R> {
    /// Make the live WKWebView and NSWindow transparent.
    ///
    /// Unlike Tauri's creation-time `transparent` option, this changes an
    /// existing webview. Enable the `macos-transparency` Cargo feature to opt
    /// into Wry's private macOS transparency API.
    fn make_transparent(&self) -> impl Future<Output = Result<(), DecorationError>> + Send {
        let window = self.clone();
        async move {
            #[cfg(feature = "macos-transparency")]
            {
                let deadline = decoration_state_typed(&window)?.activation_timeout();
                let dispatch_window = window.clone();
                dispatch_webview(&window, deadline, "make-transparent", move || {
                    traffic::make_transparent(&dispatch_window)
                        .map_err(|error| DecorationError::native_apply(error.to_string()))
                })
                .await
            }
            #[cfg(not(feature = "macos-transparency"))]
            {
                let _ = window;
                Err(DecorationError::unsupported_platform(
                    "make_transparent requires the tauri-plugin-decoration macos-transparency feature",
                ))
            }
        }
    }

    /// Set the window level.
    /// This will set the window level to the specified value.
    /// NSWindowLevel values can be found [here](https://developer.apple.com/documentation/appkit/nswindowlevel?language=objc).
    /// This is only available on macOS.
    fn set_window_level(
        &self,
        level: i32,
    ) -> impl Future<Output = Result<(), DecorationError>> + Send {
        let window = self.clone();
        async move {
            let deadline = decoration_state_typed(&window)?.activation_timeout();
            let dispatch_window = window.clone();
            dispatch_webview(&window, deadline, "window-level", move || {
                traffic::set_window_level(&dispatch_window, level)
                    .map_err(|error| DecorationError::native_apply(error.to_string()))
            })
            .await
        }
    }
}

fn decoration_state_typed<R: Runtime, M: Manager<R>>(
    manager: &M,
) -> Result<tauri::State<'_, DecorationState>, DecorationError> {
    manager.try_state::<DecorationState>().ok_or_else(|| {
        DecorationError::not_initialized(
            "register tauri_plugin_decoration::init() before webviews are created",
        )
    })
}

async fn dispatch_webview<R, T, F>(
    window: &WebviewWindow<R>,
    deadline: Duration,
    operation: &'static str,
    action: F,
) -> Result<T, DecorationError>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce() -> Result<T, DecorationError> + Send + 'static,
{
    let app = window.app_handle().clone();
    dispatch(
        move |job| {
            app.run_on_main_thread(job).map_err(|error| {
                DecorationError::new(DecorationErrorKind::MainThreadSchedule, error.to_string())
            })
        },
        action,
        deadline,
        operation,
        window.label().to_owned(),
    )
    .await
    .map_err(map_dispatch_error)
}

fn map_dispatch_error(error: DispatchError<DecorationError>) -> DecorationError {
    match error {
        DispatchError::Schedule(error) | DispatchError::Action(error) => error,
        DispatchError::CompletionDropped => DecorationError::new(
            DecorationErrorKind::MainThreadSchedule,
            "decoration main-thread action was dropped before completion",
        ),
        DispatchError::Panicked => DecorationError::new(
            DecorationErrorKind::MainThreadPanic,
            "decoration main-thread action panicked",
        ),
        DispatchError::TimedOut => DecorationError::new(
            DecorationErrorKind::MainThreadTimeout,
            "decoration queued main-thread action exceeded its deadline",
        ),
    }
}

#[cfg(target_os = "macos")]
fn platform() -> Platform {
    Platform::Macos
}

#[cfg(target_os = "windows")]
fn platform() -> Platform {
    Platform::Windows
}

#[cfg(target_os = "linux")]
fn platform() -> Platform {
    Platform::Linux
}

#[cfg(target_os = "windows")]
fn frontend_options<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<FrontendOptions, DecorationError> {
    let query_error = |error: Error| DecorationError::native_apply(error.to_string());
    let mut options = FrontendOptions::default();
    if window.is_minimizable().map_err(query_error)? {
        options.controls.push("minimize");
    }
    if window.is_maximizable().map_err(query_error)?
        && window.is_resizable().map_err(query_error)?
    {
        options.controls.push("maximize");
    }
    if window.is_closable().map_err(query_error)? {
        options.controls.push("close");
    }
    options.fullscreen = window.is_fullscreen().map_err(query_error)?;
    options.maximized = window.is_maximized().map_err(query_error)?;
    Ok(options)
}

#[cfg(target_os = "macos")]
fn frontend_options<R: Runtime>(
    _window: &WebviewWindow<R>,
) -> Result<FrontendOptions, DecorationError> {
    Ok(FrontendOptions::default())
}

#[cfg(target_os = "linux")]
fn frontend_options<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<FrontendOptions, DecorationError> {
    let mut options = linux::frontend_options(window)?;
    options.fullscreen = window
        .is_fullscreen()
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    options.maximized = window
        .is_maximized()
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    Ok(options)
}

fn evaluate_document_preparation<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    challenge: ReadinessChallenge,
    document_nonce: &str,
) -> Result<(), DecorationError> {
    let prepared = PreparedFrontend::from_options(frontend_options(window)?, platform());
    let state = decoration_state_typed(window)?;
    if !state.set_policy(window.label(), target, prepared.policy) {
        return Err(DecorationError::cancelled(
            "decoration preparation was superseded before policy installation",
        ));
    }
    let script = frontend::prepare_document_script(
        target,
        challenge,
        platform(),
        &prepared.options,
        document_nonce,
    )
    .map_err(|error| DecorationError::frontend(error.to_string()))?;
    window
        .eval(script)
        .map_err(|error| DecorationError::frontend(error.to_string()))
}

fn recover_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    claim: RecoveryClaim,
    cause: DecorationError,
) -> Result<(), DecorationError> {
    let frame_result = native::restore_frame(window);
    let helper_result = native::cleanup_helpers(window);
    let frontend_result = frontend::cancel_script(claim.target)
        .map_err(|error| error.to_string())
        .and_then(|script| window.eval(script).map_err(|error| error.to_string()));
    let mut failures = Vec::new();
    if let Err(error) = frame_result {
        failures.push(format!("restoring a usable native frame failed: {error}"));
    }
    if let Err(error) = helper_result {
        failures.push(format!(
            "removing native decoration helpers failed: {error}"
        ));
    }
    if let Err(error) = frontend_result {
        failures.push(format!(
            "removing frontend decoration state failed: {error}"
        ));
    }
    let restored = failures.is_empty();
    let completion = if restored {
        cause
    } else {
        DecorationError::native_restore(failures.join("; "))
    };
    let state = decoration_state_typed(window)?;
    if !state.finish_recovery(window.label(), claim, restored, completion.clone()) {
        return Err(DecorationError::cancelled(
            "decoration recovery ownership was superseded",
        ));
    }
    restored.then_some(()).ok_or(completion)
}

async fn activate_decoration<R: Runtime>(window: WebviewWindow<R>) -> Result<(), DecorationError> {
    let ActivationRequest::Pending {
        attempt,
        challenge,
        receiver,
        start,
        target,
    } = decoration_state_typed(&window)?.request_activation(window.label())?
    else {
        return Ok(());
    };

    if start {
        start_activation_attempt(
            window.clone(),
            attempt,
            target,
            challenge.expect("a new activation has a readiness challenge"),
        );
    }

    let result = receiver.await;
    result.unwrap_or_else(|_| {
        Err(DecorationError::cancelled(
            "decoration activation completed without publishing a result",
        ))
    })
}

fn start_activation_attempt<R: Runtime>(
    window: WebviewWindow<R>,
    attempt: AttemptId,
    target: FrontendTarget,
    challenge: ReadinessChallenge,
) {
    schedule_activation_deadline(window.clone(), attempt);
    tauri::async_runtime::spawn(async move {
        let action_window = window.clone();
        let deadline = decoration_state_typed(&window)
            .expect("activation state remains available while activation is pending")
            .activation_timeout();
        let result = dispatch_webview(&window, deadline, "activation", move || {
            begin_activation_on_main(&action_window, attempt, target, challenge)
        })
        .await;
        let timeout_claim = decoration_state_typed(&window)
            .ok()
            .and_then(|state| state.finish_activation_setup(window.label(), attempt));
        if let Some(claim) = timeout_claim {
            let deadline = decoration_state_typed(&window)
                .expect("activation state remains available while recovery is claimed")
                .activation_timeout();
            let action_window = window.clone();
            let timeout_error = DecorationError::activation_timeout(format!(
                "decoration activation exceeded {deadline:?}"
            ));
            let recovery_result = dispatch_webview(
                &window,
                deadline,
                "activation-timeout-recovery",
                move || recover_on_main(&action_window, claim, timeout_error),
            )
            .await;
            if let Err(error) = recovery_result {
                if let Ok(state) = decoration_state_typed(&window) {
                    let _ = state.finish_recovery(
                        window.label(),
                        claim,
                        false,
                        DecorationError::native_restore(error.to_string()),
                    );
                }
            }
        } else if let Err(error) = result {
            recover_dispatched_activation(&window, attempt, target, error).await;
        }
    });
}

async fn recover_dispatched_activation<R: Runtime>(
    window: &WebviewWindow<R>,
    attempt: AttemptId,
    target: FrontendTarget,
    cause: DecorationError,
) {
    let Ok(state) = decoration_state_typed(window) else {
        return;
    };
    let claim = match state.request_attempt_recovery(window.label(), attempt, target) {
        RecoveryRequest::Claimed(claim) => claim,
        RecoveryRequest::InProgress(receiver) => {
            let _ = receiver.await;
            return;
        }
        RecoveryRequest::AlreadyNative => return,
    };
    let deadline = state.activation_timeout();
    let action_window = window.clone();
    let action_cause = cause.clone();
    let result = dispatch_webview(window, deadline, "activation-recovery", move || {
        recover_on_main(&action_window, claim, action_cause)
    })
    .await;
    if let Err(error) = result {
        if let Ok(state) = decoration_state_typed(window) {
            let _ = state.finish_recovery(
                window.label(),
                claim,
                false,
                DecorationError::native_restore(error.to_string()),
            );
        }
    }
}

fn schedule_activation_deadline<R: Runtime>(window: WebviewWindow<R>, attempt: AttemptId) {
    let deadline = decoration_state_typed(&window)
        .expect("activation state was resolved before the deadline was spawned")
        .activation_timeout();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(deadline).await;
        let Ok(state) = decoration_state_typed(&window) else {
            return;
        };
        let Some(claim) = state.claim_timeout(window.label(), attempt) else {
            return;
        };
        let timeout_error = DecorationError::activation_timeout(format!(
            "decoration activation exceeded {deadline:?}"
        ));
        let action_window = window.clone();
        let action_error = timeout_error.clone();
        let result = dispatch_webview(
            &window,
            deadline,
            "activation-deadline-recovery",
            move || recover_on_main(&action_window, claim, action_error),
        )
        .await;
        if let Err(error) = result {
            if let Ok(state) = decoration_state_typed(&window) {
                let _ = state.finish_recovery(
                    window.label(),
                    claim,
                    false,
                    DecorationError::native_restore(format!(
                        "timed-out decoration recovery could not complete: {error}"
                    )),
                );
            }
        }
    });
}

fn recover_activation_error<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    cause: DecorationError,
) -> DecorationError {
    let Ok(state) = decoration_state_typed(window) else {
        return cause;
    };
    let claim = match state.request_recovery(window.label(), Some(target)) {
        RecoveryRequest::Claimed(claim) => claim,
        RecoveryRequest::InProgress(_) => return cause,
        RecoveryRequest::AlreadyNative => {
            return DecorationError::cancelled("decoration activation was superseded");
        }
    };
    match recover_on_main(window, claim, cause.clone()) {
        Ok(()) => cause,
        Err(error) => error,
    }
}

fn begin_activation_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    attempt: AttemptId,
    target: FrontendTarget,
    challenge: ReadinessChallenge,
) -> Result<(), DecorationError> {
    let state = decoration_state_typed(window)?;
    if !state.claim_activation_attempt(window.label(), attempt, target) {
        return Ok(());
    }
    let ensure_stage_current = |stage: &str| {
        if state.deadline_latched(window.label(), attempt) {
            return Err(DecorationError::activation_timeout(format!(
                "decoration activation deadline elapsed {stage}"
            )));
        }
        if !state.activation_attempt_is_current(window.label(), attempt, target) {
            return Err(DecorationError::cancelled(format!(
                "decoration activation was superseded {stage}"
            )));
        }
        Ok(())
    };
    ensure_stage_current("before native restoration")?;
    if let Err(error) = native::restore_frame(window)
        .map_err(|error| DecorationError::native_restore(error.to_string()))
    {
        return Err(recover_activation_error(window, target, error));
    }
    ensure_stage_current("after native restoration")?;
    ensure_stage_current("before native helper cleanup")?;
    let helper_result = native::cleanup_helpers(window);
    if let Err(error) =
        helper_result.map_err(|error| DecorationError::native_restore(error.to_string()))
    {
        return Err(recover_activation_error(window, target, error));
    }
    ensure_stage_current("after native helper cleanup")?;
    ensure_stage_current("before document challenge")?;
    let document_lease = state
        .document_lease(window.label(), target)
        .ok_or_else(|| DecorationError::cancelled("decoration document binding was superseded"))?;
    let script = frontend::request_document_ready_script(target, challenge, document_lease)
        .map_err(|error| DecorationError::frontend(error.to_string()))?;
    if let Err(error) = window.eval(script) {
        let error = DecorationError::frontend(error.to_string());
        return Err(recover_activation_error(window, target, error));
    }
    Ok(())
}

async fn restore_decoration<R: Runtime>(window: WebviewWindow<R>) -> Result<(), DecorationError> {
    let state = decoration_state_typed(&window)?;
    let deadline = state.activation_timeout();
    let claim = match state.request_recovery(window.label(), None) {
        RecoveryRequest::AlreadyNative => return Ok(()),
        RecoveryRequest::InProgress(receiver) => {
            return receiver.await.unwrap_or_else(|_| {
                Err(DecorationError::cancelled(
                    "decoration recovery completed without publishing a result",
                ))
            });
        }
        RecoveryRequest::Claimed(claim) => claim,
    };
    let cause = DecorationError::cancelled("decoration activation was explicitly restored");
    let action_window = window.clone();
    let result = dispatch_webview(&window, deadline, "restore", move || {
        recover_on_main(&action_window, claim, cause)
    })
    .await;
    if let Err(error) = result {
        if let Ok(state) = decoration_state_typed(&window) {
            let _ = state.finish_recovery(
                window.label(),
                claim,
                false,
                DecorationError::native_restore(error.to_string()),
            );
        }
        return Err(error);
    }
    Ok(())
}

fn reconcile_page_start_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    request: NavigationRequest,
) -> Result<(), DecorationError> {
    // This function is scheduled only after the page-load callback has yielded
    // back to the event loop. Every native stage is still lease-checked because
    // another navigation can supersede this request before the next stage.
    let state = decoration_state_typed(window)?;
    if !state.is_current_document(window.label(), request.target, request.document_lease) {
        return Ok(());
    }
    if let Some(target) = request.target {
        if let Err(error) = native::restore_frame(window)
            .map_err(|error| DecorationError::native_restore(error.to_string()))
        {
            return Err(recover_activation_error(window, target, error));
        }
        if !state.is_current_document(window.label(), Some(target), request.document_lease) {
            return Ok(());
        }
        let helper_result = native::cleanup_helpers(window);
        if let Err(error) =
            helper_result.map_err(|error| DecorationError::native_restore(error.to_string()))
        {
            return Err(recover_activation_error(window, target, error));
        }
        if !state.is_current_document(window.label(), Some(target), request.document_lease) {
            return Ok(());
        }
    }
    Ok(())
}

fn bind_document_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    document_lease: u64,
) -> Result<(), DecorationError> {
    let state = decoration_state_typed(window)?;
    if state.current_document_lease(window.label()) != Some(document_lease) {
        return Ok(());
    }
    let script = frontend::bind_document_script(document_lease)
        .map_err(|error| DecorationError::frontend(error.to_string()))?;
    window
        .eval(script)
        .map_err(|error| DecorationError::frontend(error.to_string()))
}

fn schedule_document_binding<R: Runtime>(window: WebviewWindow<R>, document_lease: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::task::yield_now().await;
        let Ok(state) = decoration_state_typed(&window) else {
            return;
        };
        let deadline = state.activation_timeout();
        let action_window = window.clone();
        if let Err(error) = dispatch_webview(&window, deadline, "document-binding", move || {
            bind_document_on_main(&action_window, document_lease)
        })
        .await
        {
            eprintln!(
                "decoration: failed to bind the current document for window {:?}: {error}",
                window.label()
            );
        }
    });
}

fn parse_frontend_token(value: &str) -> Result<u64, String> {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("decoration acknowledgement contains a non-canonical token".to_owned());
    }
    value
        .parse()
        .map_err(|_| "decoration acknowledgement token is out of range".to_owned())
}

fn validate_document_nonce(value: &str) -> Result<(), String> {
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("document readiness contains an invalid nonce".to_owned());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentChallenge {
    window_generation: String,
    document_token: String,
    challenge: String,
    document_lease: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum DocumentBootReceipt {
    Accepted { challenge: DocumentChallenge },
    Registered { document_lease: String },
    RetryCurrentBinding,
    Stale,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum DocumentReadyReceipt {
    Accepted,
    NoActivation,
    RetryCurrentBinding,
    Stale,
}

fn register_document_boot_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    document_nonce: String,
    document_lease: u64,
) -> Result<DocumentBootReceipt, DecorationError> {
    let url = window
        .url()
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    let state = decoration_state_typed(window)?;
    let decision = state.register_document_boot(
        window.label(),
        document_nonce,
        document_lease,
        url.to_string(),
    );
    Ok(match decision {
        DocumentBootDecision::Challenge(target, challenge, document_lease) => {
            DocumentBootReceipt::Accepted {
                challenge: DocumentChallenge {
                    window_generation: target.window.get().to_string(),
                    document_token: target.document.get().to_string(),
                    challenge: challenge.get().to_string(),
                    document_lease: document_lease.to_string(),
                },
            }
        }
        DocumentBootDecision::Registered(document_lease) => DocumentBootReceipt::Registered {
            document_lease: document_lease.to_string(),
        },
        DocumentBootDecision::RetryCurrentBinding => DocumentBootReceipt::RetryCurrentBinding,
        DocumentBootDecision::Stale => DocumentBootReceipt::Stale,
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn frontend_document_boot<R: Runtime>(
    webview: WebviewWindow<R>,
    _state: tauri::State<'_, DecorationState>,
    document_nonce: String,
    document_lease: String,
) -> Result<DocumentBootReceipt, String> {
    require_supported_primary_webview(&webview)?;
    validate_document_nonce(&document_nonce)?;
    let document_lease = parse_frontend_token(&document_lease)?;
    let deadline = decoration_state_typed(&webview)
        .map_err(|error| error.to_string())?
        .activation_timeout();
    let window = webview.clone();
    dispatch_webview(&webview, deadline, "document-boot", move || {
        register_document_boot_on_main(&window, document_nonce, document_lease)
    })
    .await
    .map_err(|error| error.to_string())
}

fn prepare_ready_document_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    challenge: ReadinessChallenge,
    document_nonce: &str,
    document_lease: u64,
    document_url: &str,
) -> Result<DocumentReadyReceipt, DecorationError> {
    let state = decoration_state_typed(window)?;
    let decision = state.accept_document_ready(
        window.label(),
        target,
        challenge,
        document_nonce,
        document_lease,
        document_url,
    );
    if !matches!(decision, DocumentReadyDecision::Accepted) {
        return Ok(match decision {
            DocumentReadyDecision::Accepted => DocumentReadyReceipt::Accepted,
            DocumentReadyDecision::NoActivation => DocumentReadyReceipt::NoActivation,
            DocumentReadyDecision::RetryCurrentBinding => DocumentReadyReceipt::RetryCurrentBinding,
            DocumentReadyDecision::Stale => DocumentReadyReceipt::Stale,
        });
    }
    evaluate_document_preparation(window, target, challenge, document_nonce)
        .map_err(|error| recover_activation_error(window, target, error))
        .map(|_| DocumentReadyReceipt::Accepted)
}

#[tauri::command(rename_all = "camelCase")]
async fn frontend_document_ready<R: Runtime>(
    webview: WebviewWindow<R>,
    _state: tauri::State<'_, DecorationState>,
    window_generation: String,
    document_token: String,
    challenge: String,
    document_nonce: String,
    document_lease: String,
) -> Result<DocumentReadyReceipt, String> {
    require_supported_primary_webview(&webview)?;
    let target = parse_frontend_target(&window_generation, &document_token)?;
    let challenge = ReadinessChallenge::from_raw(parse_frontend_token(&challenge)?)
        .ok_or_else(|| "document readiness challenge must be nonzero".to_owned())?;
    validate_document_nonce(&document_nonce)?;
    let document_lease = parse_frontend_token(&document_lease)?;
    let deadline = decoration_state_typed(&webview)
        .map_err(|error| error.to_string())?
        .activation_timeout();
    let window = webview.clone();
    dispatch_webview(&webview, deadline, "document-ready", move || {
        let url = window
            .url()
            .map_err(|error| DecorationError::native_apply(error.to_string()))?;
        prepare_ready_document_on_main(
            &window,
            target,
            challenge,
            &document_nonce,
            document_lease,
            url.as_str(),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

fn frontend_failure(error_code: Option<&str>) -> DecorationError {
    match error_code {
        Some(code) if code.starts_with("stylesheet-") => {
            DecorationError::stylesheet(format!("frontend stylesheet preparation failed ({code})"))
        }
        Some(code) => {
            DecorationError::frontend(format!("frontend decoration preparation failed ({code})"))
        }
        None => DecorationError::frontend("frontend decoration preparation failed"),
    }
}

fn acknowledge_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    ok: bool,
    error_code: Option<String>,
    snap_geometry: Option<SnapGeometryUpdate>,
) -> Result<(), DecorationError> {
    let initial_geometry_sequence = snap_geometry.map(SnapGeometryUpdate::sequence);
    let state = decoration_state_typed(window)?;
    if !ok {
        let cause = frontend_failure(error_code.as_deref());
        let claim = match state.request_frontend_failure(window.label(), Some(target)) {
            RecoveryRequest::Claimed(claim) => claim,
            RecoveryRequest::InProgress(_) => {
                return Err(DecorationError::cancelled(
                    "decoration recovery is already in progress",
                ));
            }
            RecoveryRequest::AlreadyNative => {
                return Err(DecorationError::cancelled(
                    "stale decoration failure acknowledgement",
                ));
            }
        };
        recover_on_main(window, claim, cause)?;
        return Ok(());
    }

    if initial_geometry_sequence.is_some_and(|sequence| sequence != 1) {
        return Err(deny_action(
            window,
            "initial snap geometry sequence must be exactly 1",
        ));
    }

    match state.begin_native_apply(window.label(), target) {
        ReadinessDecision::AlreadyActive => return Ok(()),
        ReadinessDecision::AlreadyApplying => {
            return Err(DecorationError::cancelled(
                "decoration native activation is already in progress",
            ));
        }
        ReadinessDecision::Stale => {
            return Err(DecorationError::cancelled(
                "stale decoration readiness acknowledgement",
            ));
        }
        ReadinessDecision::Apply => {}
    }
    if !state.native_apply_is_current(window.label(), target) {
        return Err(recover_activation_error(
            window,
            target,
            DecorationError::cancelled("decoration native activation was superseded before apply"),
        ));
    }
    if let Err(error) = native::apply_decorations(window, target, snap_geometry) {
        return Err(recover_activation_error(window, target, error));
    }

    let state = decoration_state_typed(window)?;
    if !state.native_apply_is_current(window.label(), target) {
        return Err(recover_activation_error(
            window,
            target,
            DecorationError::cancelled("decoration native activation was superseded after apply"),
        ));
    }
    if initial_geometry_sequence.is_some()
        && !state.record_geometry_operation(
            window.label(),
            target,
            snap_geometry.expect("initial geometry sequence has an update"),
        )
    {
        return Err(recover_activation_error(
            window,
            target,
            DecorationError::cancelled(
                "initial snap geometry sequence was superseded before commit",
            ),
        ));
    }
    if !state.native_apply_is_current(window.label(), target) {
        return Err(recover_activation_error(
            window,
            target,
            DecorationError::cancelled(
                "decoration native activation was superseded before native commit",
            ),
        ));
    }
    if state.complete_activation(window.label(), target) {
        Ok(())
    } else {
        Err(recover_activation_error(
            window,
            target,
            DecorationError::cancelled("decoration activation was superseded before native commit"),
        ))
    }
}

fn primary_webview_labels_match(webview_label: &str, native_window_label: &str) -> bool {
    webview_label == native_window_label
}

fn require_primary_webview<R: Runtime>(webview: &WebviewWindow<R>) -> Result<(), String> {
    let native_window = webview.as_ref().window();
    if primary_webview_labels_match(webview.label(), native_window.label()) {
        Ok(())
    } else {
        Err("decoration commands are limited to the native window's primary webview".to_owned())
    }
}

fn supported_document_origin(url: &tauri::webview::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "::1" | "[::1]" | "tauri.localhost")
        ),
        _ => false,
    }
}

fn require_supported_primary_webview<R: Runtime>(webview: &WebviewWindow<R>) -> Result<(), String> {
    require_primary_webview(webview)?;
    let url = webview.url().map_err(|error| error.to_string())?;
    if supported_document_origin(&url) {
        Ok(())
    } else {
        Err("decoration commands are limited to supported application origins".to_owned())
    }
}

// Native frame changes can synchronously call back into WebView2 on Windows.
// Run this command off the synchronous IPC handler, then dispatch native work
// to the event-loop thread so WebView2 is not re-entered by its own request.
fn parse_frontend_target(
    window_generation: &str,
    document_token: &str,
) -> Result<FrontendTarget, String> {
    let window_generation = parse_frontend_token(window_generation)?;
    let document_token = parse_frontend_token(document_token)?;
    FrontendTarget::from_values(window_generation, document_token)
        .ok_or_else(|| "decoration acknowledgement tokens must be nonzero".to_owned())
}

fn parse_snap_geometry_update(
    update: Option<FrontendSnapGeometryUpdate>,
) -> Result<Option<SnapGeometryUpdate>, String> {
    let Some(update) = update else {
        return Ok(None);
    };
    let update = match update {
        FrontendSnapGeometryUpdate::Geometry { geometry, sequence } => {
            SnapGeometryUpdate::Geometry {
                geometry,
                sequence: parse_frontend_token(&sequence)?,
            }
        }
        FrontendSnapGeometryUpdate::Disabled { fallback, sequence } => {
            SnapGeometryUpdate::Disabled {
                fallback,
                sequence: parse_frontend_token(&sequence)?,
            }
        }
    };
    Ok(Some(update))
}

#[tauri::command(rename_all = "camelCase")]
async fn frontend_ack<R: Runtime>(
    webview: WebviewWindow<R>,
    _state: tauri::State<'_, DecorationState>,
    window_generation: String,
    document_token: String,
    ok: bool,
    error_code: Option<String>,
    snap_geometry: Option<FrontendSnapGeometryUpdate>,
) -> Result<(), String> {
    require_supported_primary_webview(&webview)?;
    let target = parse_frontend_target(&window_generation, &document_token)?;
    let snap_geometry = parse_snap_geometry_update(snap_geometry)?;
    let deadline = decoration_state_typed(&webview)
        .map_err(|error| error.to_string())?
        .activation_timeout();
    let window = webview.clone();
    dispatch_webview(&webview, deadline, "frontend-ack", move || {
        acknowledge_on_main(&window, target, ok, error_code, snap_geometry)
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn update_frontend_geometry_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    update: SnapGeometryUpdate,
) -> Result<GeometryReceipt, DecorationError> {
    let state = decoration_state_typed(window)?;
    let cursor = || {
        state
            .geometry_cursor(window.label(), target)
            .unwrap_or_default()
            .to_string()
    };
    let committed_operation = state.geometry_operation(window.label(), target);
    match state.accept_geometry(window.label(), target, update) {
        GeometryDecision::Denied => {
            return Err(deny_action(window, "snap geometry is not authorized"));
        }
        GeometryDecision::Stale => {
            return Ok(GeometryReceipt {
                applied: false,
                cursor: cursor(),
                operation: committed_operation.map(SnapGeometryUpdate::receipt),
            });
        }
        GeometryDecision::Retry => {
            return Ok(GeometryReceipt {
                applied: true,
                cursor: cursor(),
                operation: committed_operation.map(SnapGeometryUpdate::receipt),
            });
        }
        GeometryDecision::Conflict => {
            return Ok(GeometryReceipt {
                applied: false,
                cursor: cursor(),
                operation: committed_operation.map(SnapGeometryUpdate::receipt),
            });
        }
        GeometryDecision::Next => {}
    }
    if matches!(update, SnapGeometryUpdate::Geometry { .. })
        && window
            .is_fullscreen()
            .map_err(|error| DecorationError::native_apply(error.to_string()))?
    {
        return Err(deny_action(
            window,
            "snap geometry is disabled while fullscreen",
        ));
    }
    snap::apply_update(window, target, update)
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    if !state.commit_geometry(window.label(), target, update) {
        return Err(DecorationError::cancelled(
            "snap geometry target was superseded before sequence commit",
        ));
    }
    Ok(GeometryReceipt {
        applied: true,
        cursor: update.sequence().to_string(),
        operation: Some(update.receipt()),
    })
}

#[cfg(not(target_os = "windows"))]
fn update_frontend_geometry_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    _target: FrontendTarget,
    _update: SnapGeometryUpdate,
) -> Result<GeometryReceipt, DecorationError> {
    Err(deny_action(
        window,
        "snap geometry is supported only on Windows",
    ))
}

#[tauri::command(rename_all = "camelCase")]
async fn frontend_geometry<R: Runtime>(
    webview: WebviewWindow<R>,
    _state: tauri::State<'_, DecorationState>,
    window_generation: String,
    document_token: String,
    snap_geometry: FrontendSnapGeometryUpdate,
) -> Result<GeometryReceipt, String> {
    require_supported_primary_webview(&webview)?;
    let target = parse_frontend_target(&window_generation, &document_token)?;
    let Some(snap_geometry) = parse_snap_geometry_update(Some(snap_geometry))? else {
        return Err("a geometry command must contain a geometry state".to_owned());
    };
    let deadline = decoration_state_typed(&webview)
        .map_err(|error| error.to_string())?
        .activation_timeout();
    let window = webview.clone();
    dispatch_webview(&webview, deadline, "frontend-geometry", move || {
        update_frontend_geometry_on_main(&window, target, snap_geometry)
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum WindowControlAction {
    Minimize,
    ToggleMaximize,
    Close,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct CurrentWindowCapabilities {
    closable: bool,
    maximizable: bool,
    maximized: bool,
    minimizable: bool,
    resizable: bool,
}

#[cfg(test)]
fn action_is_authorized(
    policy: WindowControlPolicy,
    current: CurrentWindowCapabilities,
    action: WindowControlAction,
) -> bool {
    match action {
        WindowControlAction::Minimize => policy.minimize && current.minimizable,
        WindowControlAction::ToggleMaximize if current.maximized => policy.toggle_maximize,
        WindowControlAction::ToggleMaximize => {
            policy.toggle_maximize && current.maximizable && current.resizable
        }
        WindowControlAction::Close => policy.close && current.closable,
    }
}

fn deny_action<R: Runtime>(_window: &WebviewWindow<R>, reason: &'static str) -> DecorationError {
    DecorationError::action_denied(reason)
}

fn window_control_on_main<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    action: WindowControlAction,
) -> Result<(), DecorationError> {
    let state = decoration_state_typed(window)?;
    let Some(policy) = state.active_policy(window.label(), target) else {
        return Err(deny_action(
            window,
            "no active capability policy matches the frontend target",
        ));
    };
    let result = match action {
        WindowControlAction::Minimize => {
            if !policy.minimize {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            #[cfg(target_os = "windows")]
            if !window
                .is_minimizable()
                .map_err(|error| DecorationError::native_apply(error.to_string()))?
            {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            window.minimize()
        }
        WindowControlAction::ToggleMaximize => {
            if !policy.toggle_maximize {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            let maximized = window
                .is_maximized()
                .map_err(|error| DecorationError::native_apply(error.to_string()))?;
            if maximized {
                window.unmaximize()
            } else {
                #[cfg(target_os = "windows")]
                if !window
                    .is_maximizable()
                    .map_err(|error| DecorationError::native_apply(error.to_string()))?
                    || !window
                        .is_resizable()
                        .map_err(|error| DecorationError::native_apply(error.to_string()))?
                {
                    return Err(deny_action(
                        window,
                        "the requested window control is not authorized",
                    ));
                }
                #[cfg(target_os = "linux")]
                if !window
                    .gtk_window()
                    .map_err(|error| DecorationError::native_apply(error.to_string()))?
                    .is_resizable()
                {
                    return Err(deny_action(
                        window,
                        "the requested window control is not authorized",
                    ));
                }
                window.maximize()
            }
        }
        WindowControlAction::Close => {
            if !policy.close {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            #[cfg(target_os = "windows")]
            if !window
                .is_closable()
                .map_err(|error| DecorationError::native_apply(error.to_string()))?
            {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            #[cfg(target_os = "linux")]
            if !window
                .gtk_window()
                .map_err(|error| DecorationError::native_apply(error.to_string()))?
                .is_deletable()
            {
                return Err(deny_action(
                    window,
                    "the requested window control is not authorized",
                ));
            }
            window.close()
        }
    };
    result.map_err(|error| DecorationError::native_apply(error.to_string()))
}

#[tauri::command(rename_all = "camelCase")]
async fn window_control<R: Runtime>(
    webview: WebviewWindow<R>,
    _state: tauri::State<'_, DecorationState>,
    window_generation: String,
    document_token: String,
    action: WindowControlAction,
) -> Result<(), String> {
    require_supported_primary_webview(&webview)?;
    let target = parse_frontend_target(&window_generation, &document_token)?;
    let deadline = decoration_state_typed(&webview)
        .map_err(|error| error.to_string())?
        .activation_timeout();
    let window = webview.clone();
    dispatch_webview(&webview, deadline, "window-control", move || {
        window_control_on_main(&window, target, action)
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct FrontendWindowState {
    maximized: bool,
    fullscreen: bool,
    revision: u64,
}

fn synchronize_frontend_window_state<R: Runtime>(window: WebviewWindow<R>) {
    let Ok(state) = decoration_state_typed(&window) else {
        return;
    };
    let Some((target, revision)) = state.claim_window_state_revision(window.label()) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let state = match (window.is_maximized(), window.is_fullscreen()) {
            (Ok(maximized), Ok(fullscreen)) => FrontendWindowState {
                maximized,
                fullscreen,
                revision,
            },
            (maximized, fullscreen) => {
                eprintln!(
                    "decoration: failed to query window state for {:?}: maximized={maximized:?}, fullscreen={fullscreen:?}",
                    window.label()
                );
                return;
            }
        };
        let Ok(script) = frontend::dispatch_script(target, "window-state", &state) else {
            return;
        };
        if let Err(error) = window.eval(script) {
            eprintln!(
                "decoration: failed to synchronize window state for {:?}: {error}",
                window.label()
            );
        }
    });
}

fn build_plugin<R: Runtime>(activation_timeout: Duration) -> TauriPlugin<R> {
    Builder::new("decoration")
        .initialization_script(frontend::init_script(platform()))
        .register_uri_scheme_protocol(protocol::SCHEME, |_context, request| {
            protocol::handle(request)
        })
        .invoke_handler(tauri::generate_handler![
            frontend_ack,
            frontend_document_boot,
            frontend_document_ready,
            frontend_geometry,
            window_control
        ])
        .setup(move |app, _api| {
            if app.manage(DecorationState::new(activation_timeout)) {
                Ok(())
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "tauri-plugin-decoration state was already initialized",
                )
                .into())
            }
        })
        .on_page_load(|webview, payload| {
            let Some(window) = webview.app_handle().get_webview_window(webview.label()) else {
                return;
            };
            let url = payload.url().clone().to_string();
            let Some(state) = decoration_state_typed(&window).ok() else {
                return;
            };
            // Tauri 3 can deliver Started before the destination document can receive eval.
            // Rebind the same lease after navigation instead of creating a second document.
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Some(lease) = state.current_document_lease(window.label()) {
                    schedule_document_binding(window, lease);
                    return;
                }
            }
            let Some(request) = state.page_started(window.label(), url) else {
                return;
            };
            schedule_document_binding(window.clone(), request.document_lease);
            if request.start_deadline {
                schedule_activation_deadline(
                    window.clone(),
                    request
                        .attempt
                        .expect("activation navigation has an attempt"),
                );
            }
            tauri::async_runtime::spawn(async move {
                tokio::task::yield_now().await;
                let schedule_window = window.clone();
                let schedule_label = schedule_window.label().to_owned();
                let reconcile_window = schedule_window.clone();
                let result = schedule_window.run_on_main_thread(move || {
                    match catch_unwind(AssertUnwindSafe(|| {
                        reconcile_page_start_on_main(&reconcile_window, request)
                    })) {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            eprintln!(
                                "decoration: failed to reconcile page for window {:?}: {error}",
                                reconcile_window.label()
                            );
                        }
                        Err(_) => eprintln!(
                            "decoration: page reconciliation panicked for window {:?}",
                            reconcile_window.label()
                        ),
                    }
                });
                if let Err(error) = result {
                    eprintln!(
                        "decoration: failed to schedule page reconciliation for window {schedule_label:?}: {error}"
                    );
                }
            });
        })
        .on_event(|app, event| {
            match &event {
                RunEvent::Exit => {
                    if let Some(state) = app.try_state::<DecorationState>() {
                        state.shutdown();
                    }
                    return;
                }
                RunEvent::ExitRequested { .. } => return,
                _ => {}
            }
            let RunEvent::WindowEvent { label, event, .. } = event else {
                return;
            };
            #[cfg(target_os = "windows")]
            if matches!(event, WindowEvent::Resized(_)) {
                if let Some(window) = app.get_webview_window(label) {
                    if let Err(error) = snap::refresh_fullscreen(&window) {
                        eprintln!(
                            "decoration: failed to synchronize Windows fullscreen state for window {label:?}: {error}"
                        );
                    }
                }
            }
            if matches!(
                event,
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Some(window) = app.get_webview_window(label) {
                    synchronize_frontend_window_state(window);
                }
            }
            if matches!(event, WindowEvent::Destroyed)
                && app.get_webview_window(label).is_none()
            {
                if let Some(state) = app.try_state::<DecorationState>() {
                    if let Some(generation) = state.begin_destroy_current(label) {
                        let finish_app = app.clone();
                        let finish_label = label.clone();
                        if let Err(error) = app.run_on_main_thread(move || {
                            if let Some(state) = finish_app.try_state::<DecorationState>() {
                                state.finish_destroy(&finish_label, generation);
                            }
                        }) {
                            eprintln!(
                                "decoration: failed to schedule terminal cleanup for window {label:?}: {error}"
                            );
                        }
                    }
                }
            }
        })
        .build()
}

/// Builds the plugin with default configuration.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    builder().build()
}

#[cfg(test)]
mod tests {
    use super::{
        action_is_authorized, parse_frontend_token, parse_snap_geometry_update,
        primary_webview_labels_match, supported_document_origin, CurrentWindowCapabilities,
        WindowControlAction,
    };
    use crate::frontend::{
        ControlLayout, FrontendOptions, FrontendSnapGeometryUpdate, Platform, PreparedFrontend,
        SnapGeometry, SnapGeometryUpdate, WindowControlPolicy,
    };
    use crate::native::run_linux_restoration;
    use anyhow::anyhow;
    use std::{
        cell::RefCell,
        sync::atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn frontend_tokens_are_canonical_nonzero_u64_values() {
        assert_eq!(parse_frontend_token("1"), Ok(1));
        assert_eq!(parse_frontend_token(&u64::MAX.to_string()), Ok(u64::MAX));
        for invalid in ["", "0", "01", "+1", "1.0", "18446744073709551616"] {
            assert!(parse_frontend_token(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn geometry_update_payloads_require_canonical_nonzero_sequences() {
        let geometry = SnapGeometry {
            control_band_width: 174,
            height: 32,
            titlebar_height: 32,
            width: 58,
            x: 684,
            y: 0,
        };
        assert_eq!(
            parse_snap_geometry_update(Some(FrontendSnapGeometryUpdate::Geometry {
                geometry,
                sequence: "7".to_owned(),
            })),
            Ok(Some(SnapGeometryUpdate::Geometry {
                geometry,
                sequence: 7,
            }))
        );
        assert_eq!(
            parse_snap_geometry_update(Some(FrontendSnapGeometryUpdate::Disabled {
                fallback: false,
                sequence: "8".to_owned(),
            })),
            Ok(Some(SnapGeometryUpdate::Disabled {
                fallback: false,
                sequence: 8,
            }))
        );
        for sequence in ["", "0", "01", "not-a-number"] {
            assert!(
                parse_snap_geometry_update(Some(FrontendSnapGeometryUpdate::Disabled {
                    fallback: false,
                    sequence: sequence.to_owned(),
                }))
                .is_err()
            );
        }
    }

    #[test]
    fn only_the_native_windows_primary_webview_can_drive_its_decoration() {
        assert!(primary_webview_labels_match("main", "main"));
        assert!(!primary_webview_labels_match("sidebar", "main"));
        assert!(!primary_webview_labels_match("main", "other-window"));
    }

    #[test]
    fn supported_document_origins_are_separate_from_document_identity() {
        for supported in [
            "tauri://localhost/index.html",
            "asset://localhost/index.html",
            "http://localhost:1420/",
            "https://tauri.localhost/app",
        ] {
            assert!(
                supported_document_origin(&supported.parse().unwrap()),
                "{supported}"
            );
        }
        for unsupported in [
            "file:///tmp/index.html",
            "https://example.com/",
            "http://tauri.localhost.example/",
        ] {
            assert!(
                !supported_document_origin(&unsupported.parse().unwrap()),
                "{unsupported}"
            );
        }
    }

    #[test]
    fn visible_linux_restoration_unmaps_before_restoring_and_remaps_afterward() {
        let operations = RefCell::new(Vec::new());
        run_linux_restoration(
            true,
            || {
                operations.borrow_mut().push("hide");
                Ok(())
            },
            || {
                operations.borrow_mut().push("restore");
                Ok(())
            },
            || {
                operations.borrow_mut().push("show");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*operations.borrow(), ["hide", "restore", "show"]);
    }

    #[test]
    fn failed_visible_linux_restoration_still_attempts_to_remap() {
        let shown = AtomicUsize::new(0);
        let error = run_linux_restoration(
            true,
            || Ok(()),
            || Err(anyhow!("restore failed").into()),
            || {
                shown.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("restore failed"));
        assert_eq!(shown.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn hide_failure_does_not_skip_linux_frame_restoration_or_reveal() {
        let operations = RefCell::new(Vec::new());
        run_linux_restoration(
            true,
            || {
                operations.borrow_mut().push("hide");
                Err(anyhow!("hide failed").into())
            },
            || {
                operations.borrow_mut().push("restore");
                Ok(())
            },
            || {
                operations.borrow_mut().push("show");
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(*operations.borrow(), ["hide", "restore", "show"]);
    }

    #[test]
    fn linux_restoration_aggregates_primary_and_reveal_failures() {
        let error = run_linux_restoration(
            true,
            || Err(anyhow!("hide failed").into()),
            || Err(anyhow!("restore failed").into()),
            || Err(anyhow!("show failed").into()),
        )
        .unwrap_err()
        .to_string();

        for expected in ["hide failed", "restore failed", "show failed"] {
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn command_policy_denies_absent_controls_and_live_capability_changes() {
        let all_current = CurrentWindowCapabilities {
            closable: true,
            maximizable: true,
            maximized: false,
            minimizable: true,
            resizable: true,
        };
        let policy = WindowControlPolicy {
            close: true,
            minimize: true,
            snap_geometry: true,
            toggle_maximize: true,
        };

        for action in [
            WindowControlAction::Minimize,
            WindowControlAction::ToggleMaximize,
            WindowControlAction::Close,
        ] {
            assert!(action_is_authorized(policy, all_current, action));
            assert!(!action_is_authorized(
                WindowControlPolicy::default(),
                all_current,
                action
            ));
        }

        assert!(!action_is_authorized(
            policy,
            CurrentWindowCapabilities {
                minimizable: false,
                ..all_current
            },
            WindowControlAction::Minimize
        ));
        assert!(!action_is_authorized(
            policy,
            CurrentWindowCapabilities {
                closable: false,
                ..all_current
            },
            WindowControlAction::Close
        ));
        assert!(!action_is_authorized(
            policy,
            CurrentWindowCapabilities {
                resizable: false,
                ..all_current
            },
            WindowControlAction::ToggleMaximize
        ));
    }

    #[test]
    fn linux_window_control_authorization_denies_controls_omitted_from_gtk_layout() {
        let prepared = PreparedFrontend::from_options(
            FrontendOptions {
                controls: vec!["minimize", "maximize", "close"],
                layout: Some(ControlLayout {
                    left: vec!["close"],
                    right: vec![],
                }),
                ..FrontendOptions::default()
            },
            Platform::Linux,
        );
        let current = CurrentWindowCapabilities {
            closable: true,
            maximizable: true,
            maximized: false,
            minimizable: true,
            resizable: true,
        };

        assert!(action_is_authorized(
            prepared.policy,
            current,
            WindowControlAction::Close
        ));
        assert!(!action_is_authorized(
            prepared.policy,
            current,
            WindowControlAction::Minimize
        ));
        assert!(!action_is_authorized(
            prepared.policy,
            current,
            WindowControlAction::ToggleMaximize
        ));
    }

    #[test]
    fn authorized_restore_from_maximized_does_not_require_current_resize_capability() {
        let policy = WindowControlPolicy {
            toggle_maximize: true,
            ..WindowControlPolicy::default()
        };
        let current = CurrentWindowCapabilities {
            maximized: true,
            ..CurrentWindowCapabilities::default()
        };

        assert!(action_is_authorized(
            policy,
            current,
            WindowControlAction::ToggleMaximize
        ));
    }
}
