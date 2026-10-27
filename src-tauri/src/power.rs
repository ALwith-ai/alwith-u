//! App-wide sleep inhibition follows Runtime snapshots, independently of webview lifetime.
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Policy<T> {
    enabled: bool,
    active: bool,
    lease: Option<T>,
}
impl<T> Policy<T> {
    fn reconcile(&mut self, acquire: impl FnOnce() -> Result<T, String>) -> Result<(), String> {
        if self.enabled && self.active {
            if self.lease.is_none() {
                self.lease = Some(acquire()?);
            }
        } else {
            self.lease.take();
        }
        Ok(())
    }
}

pub struct PreventSleep(Mutex<Policy<keepawake::KeepAwake>>);
impl Default for PreventSleep {
    fn default() -> Self {
        Self(Mutex::new(Policy { enabled: false, active: false, lease: None }))
    }
}
impl PreventSleep {
    fn update(&self, enabled: Option<bool>, active: Option<bool>) -> Result<(), String> {
        let mut policy = self.0.lock().map_err(|error| error.to_string())?;
        if let Some(enabled) = enabled {
            policy.enabled = enabled;
        }
        if let Some(active) = active {
            policy.active = active;
        }
        policy.reconcile(|| {
            keepawake::Builder::default()
                .display(false)
                .idle(true)
                .sleep(true)
                .reason("Agent is running")
                .app_name("ALwith U")
                .app_reverse_domain("ai.alwith.u")
                .create()
                .map_err(|error| error.to_string())
        })
    }
    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.update(Some(enabled), None)
    }
}

pub fn sync(app: &tauri::AppHandle, active: bool) {
    if let Err(error) = app.state::<PreventSleep>().update(None, Some(active)) {
        log::error!("Sleep inhibition failed: {error}");
        let _ = app.emit("power:error", error);
    }
}

pub fn has_active_tasks<'a>(states: impl IntoIterator<Item = &'a alwith_api::RunState>) -> bool {
    states
        .into_iter()
        .any(|state| matches!(state, alwith_api::RunState::Running | alwith_api::RunState::RequiresAction))
}

#[cfg(test)]
#[path = "__tests__/power.rs"]
mod tests;
