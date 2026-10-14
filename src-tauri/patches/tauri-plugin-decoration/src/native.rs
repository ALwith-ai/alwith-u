use crate::{
    decoration_state_typed,
    frontend::{SnapGeometryUpdate, WindowControlPolicy},
    lifecycle::FrontendTarget,
    DecorationError,
};
#[cfg(any(target_os = "linux", test))]
use anyhow::anyhow;
use tauri::{Error, Runtime, WebviewWindow};

fn prepared_policy<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
) -> Result<WindowControlPolicy, DecorationError> {
    decoration_state_typed(window)?
        .policy(window.label(), target)
        .ok_or_else(|| {
            DecorationError::action_denied(
                "native decoration apply has no matching prepared capability policy",
            )
        })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn restore_frame<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    window.set_decorations(true)
}

#[cfg(target_os = "linux")]
pub(crate) fn restore_frame<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    let visible = window.is_visible()?;
    run_linux_restoration(
        visible,
        || window.hide(),
        || window.set_decorations(true),
        || window.show(),
    )
}

#[cfg(target_os = "windows")]
pub(crate) fn cleanup_helpers<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    crate::snap::uninstall(window)
}

#[cfg(target_os = "macos")]
pub(crate) fn cleanup_helpers<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Error> {
    crate::traffic::deactivate(window)
}

#[cfg(target_os = "linux")]
pub(crate) fn cleanup_helpers<R: Runtime>(_window: &WebviewWindow<R>) -> Result<(), Error> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn apply_decorations<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    _snap_geometry: Option<SnapGeometryUpdate>,
) -> Result<(), DecorationError> {
    prepared_policy(window, target)?;
    window
        .set_decorations(true)
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    crate::traffic::activate(window, target)
        .map_err(|error| DecorationError::native_apply(error.to_string()))
}

#[cfg(target_os = "windows")]
pub(crate) fn apply_decorations<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    snap_geometry: Option<SnapGeometryUpdate>,
) -> Result<(), DecorationError> {
    let policy = prepared_policy(window, target)?;
    if policy.snap_geometry {
        match snap_geometry {
            Some(update) => crate::snap::apply_update(window, target, update)
                .map_err(|error| DecorationError::native_apply(error.to_string()))?,
            None => {
                return Err(DecorationError::native_apply(
                    "maximize geometry state was not reported",
                ));
            }
        }
    }
    window
        .set_decorations(false)
        .map_err(|error| DecorationError::native_apply(error.to_string()))
}

#[cfg(target_os = "linux")]
pub(crate) fn apply_decorations<R: Runtime>(
    window: &WebviewWindow<R>,
    target: FrontendTarget,
    _snap_geometry: Option<SnapGeometryUpdate>,
) -> Result<(), DecorationError> {
    prepared_policy(window, target)?;
    window
        .set_decorations(false)
        .map_err(|error| DecorationError::native_apply(error.to_string()))
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn run_linux_restoration(
    visible: bool,
    hide: impl FnOnce() -> Result<(), Error>,
    restore: impl FnOnce() -> Result<(), Error>,
    show: impl FnOnce() -> Result<(), Error>,
) -> Result<(), Error> {
    if !visible {
        return restore();
    }

    let hide_result = hide();
    let restore_result = restore();
    let show_result = show();
    match (hide_result, restore_result, show_result) {
        (Ok(()), Ok(()), Ok(())) => Ok(()),
        (Err(hide), Ok(()), Ok(())) => {
            eprintln!("decoration: hiding the Linux window before restoration failed: {hide}");
            Ok(())
        }
        (hide, restore, show) => {
            let mut failures = Vec::new();
            if let Err(error) = hide {
                failures.push(format!("hiding the window failed: {error}"));
            }
            if let Err(error) = restore {
                failures.push(format!("restoring native decorations failed: {error}"));
            }
            if let Err(error) = show {
                failures.push(format!("showing the window again failed: {error}"));
            }
            Err(anyhow!(failures.join("; ")).into())
        }
    }
}
