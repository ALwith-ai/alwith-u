use crate::lifecycle::{FrontendTarget, ReadinessChallenge};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Platform {
    #[cfg(any(target_os = "macos", test))]
    Macos,
    #[cfg(any(target_os = "windows", test))]
    Windows,
    #[cfg(any(target_os = "linux", test))]
    Linux,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct ControlLayout {
    pub(crate) left: Vec<&'static str>,
    pub(crate) right: Vec<&'static str>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct FrontendOptions {
    pub(crate) controls: Vec<&'static str>,
    pub(crate) fullscreen: bool,
    pub(crate) icons: BTreeMap<&'static str, String>,
    pub(crate) layout: Option<ControlLayout>,
    pub(crate) maximized: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct WindowControlPolicy {
    pub(crate) close: bool,
    pub(crate) minimize: bool,
    pub(crate) snap_geometry: bool,
    pub(crate) toggle_maximize: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedFrontend {
    pub(crate) options: FrontendOptions,
    pub(crate) policy: WindowControlPolicy,
}

impl PreparedFrontend {
    pub(crate) fn from_options(options: FrontendOptions, platform: Platform) -> Self {
        let rendered_control = |control: &str| {
            if let Some(layout) = options.layout.as_ref() {
                layout.left.contains(&control) || layout.right.contains(&control)
            } else {
                options.controls.contains(&control)
            }
        };
        let policy = WindowControlPolicy {
            close: rendered_control("close"),
            minimize: rendered_control("minimize"),
            snap_geometry: {
                #[allow(unreachable_patterns)]
                match platform {
                    #[cfg(any(target_os = "windows", test))]
                    Platform::Windows => rendered_control("maximize"),
                    _ => false,
                }
            },
            toggle_maximize: rendered_control("maximize"),
        };
        Self { options, policy }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapGeometry {
    pub(crate) control_band_width: u32,
    pub(crate) height: u32,
    pub(crate) titlebar_height: u32,
    pub(crate) width: u32,
    pub(crate) x: i32,
    pub(crate) y: i32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum FrontendSnapGeometryUpdate {
    Geometry {
        geometry: SnapGeometry,
        sequence: String,
    },
    Disabled {
        fallback: bool,
        sequence: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SnapGeometryUpdate {
    Geometry {
        geometry: SnapGeometry,
        sequence: u64,
    },
    Disabled {
        fallback: bool,
        sequence: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeometryReceipt {
    pub(crate) applied: bool,
    pub(crate) cursor: String,
    pub(crate) operation: Option<FrontendSnapGeometryUpdate>,
}

impl SnapGeometryUpdate {
    pub(crate) fn sequence(self) -> u64 {
        match self {
            Self::Geometry { sequence, .. } | Self::Disabled { sequence, .. } => sequence,
        }
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn receipt(self) -> FrontendSnapGeometryUpdate {
        match self {
            Self::Geometry { geometry, sequence } => FrontendSnapGeometryUpdate::Geometry {
                geometry,
                sequence: sequence.to_string(),
            },
            Self::Disabled { fallback, sequence } => FrontendSnapGeometryUpdate::Disabled {
                fallback,
                sequence: sequence.to_string(),
            },
        }
    }
}

pub(crate) fn dispatch_script<T: Serialize>(
    target: FrontendTarget,
    event: &'static str,
    payload: &T,
) -> Result<String, serde_json::Error> {
    let window_generation = serde_json::to_string(&target.window.get().to_string())?;
    let document_token = serde_json::to_string(&target.document.get().to_string())?;
    let event = serde_json::to_string(event)?;
    let payload = serde_json::to_string(payload)?;
    Ok(format!(
        "void window.__TAURI_PLUGIN_DECORATION__?.dispatch({window_generation},{document_token},{event},{payload});"
    ))
}

pub(crate) fn prepare_script(
    target: FrontendTarget,
    platform: Platform,
    options: &FrontendOptions,
) -> Result<String, serde_json::Error> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct InstallerConfig<'a> {
        window_generation: String,
        document_token: String,
        platform: Platform,
        controls: &'a [&'static str],
        fullscreen: bool,
        icons: &'a BTreeMap<&'static str, String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        layout: Option<&'a ControlLayout>,
        maximized: bool,
    }

    let config = serde_json::to_string(&InstallerConfig {
        window_generation: target.window.get().to_string(),
        document_token: target.document.get().to_string(),
        platform,
        controls: &options.controls,
        fullscreen: options.fullscreen,
        icons: &options.icons,
        layout: options.layout.as_ref(),
        maximized: options.maximized,
    })?;
    Ok(format!(
        "void window.__TAURI_PLUGIN_DECORATION__?.install({config});"
    ))
}

pub(crate) fn prepare_document_script(
    target: FrontendTarget,
    challenge: ReadinessChallenge,
    platform: Platform,
    options: &FrontendOptions,
    document_nonce: &str,
) -> Result<String, serde_json::Error> {
    let direct = prepare_script(target, platform, options)?;
    let nonce = serde_json::to_string(document_nonce)?;
    let challenge = serde_json::to_string(&challenge.get().to_string())?;
    Ok(direct.replacen(
        "?.install(",
        &format!("?.installForDocument({nonce},{challenge},"),
        1,
    ))
}

pub(crate) fn request_document_ready_script(
    target: FrontendTarget,
    challenge: ReadinessChallenge,
    document_lease: u64,
) -> Result<String, serde_json::Error> {
    let window_generation = serde_json::to_string(&target.window.get().to_string())?;
    let document_token = serde_json::to_string(&target.document.get().to_string())?;
    let challenge = serde_json::to_string(&challenge.get().to_string())?;
    let document_lease = serde_json::to_string(&document_lease.to_string())?;
    Ok(format!(
        "void window.__TAURI_PLUGIN_DECORATION__?.challengeDocument({window_generation},{document_token},{challenge},{document_lease});"
    ))
}

pub(crate) fn bind_document_script(document_lease: u64) -> Result<String, serde_json::Error> {
    let document_lease = serde_json::to_string(&document_lease.to_string())?;
    Ok(format!(
        "(()=>{{const lease={document_lease};const slot=\"__TAURI_PLUGIN_DECORATION_DOCUMENT_LEASE__\";const runtime=window.__TAURI_PLUGIN_DECORATION__;if(typeof runtime?.bindDocumentLease===\"function\"){{void runtime.bindDocumentLease(lease);}}else{{window[slot]=lease;}}}})();"
    ))
}

pub(crate) fn init_script(platform: Platform) -> String {
    let adapter = match platform {
        #[cfg(any(target_os = "macos", test))]
        Platform::Macos => "",
        #[cfg(any(target_os = "windows", test))]
        Platform::Windows => include_str!("js/controls.js"),
        #[cfg(any(target_os = "linux", test))]
        Platform::Linux => include_str!("js/linux-controls.js"),
    };
    let core = include_str!("js/titlebar.js");
    let mut script = String::with_capacity(core.len() + adapter.len() + 1);
    script.push_str(core);
    script.push('\n');
    script.push_str(adapter);
    script
}

pub(crate) fn cancel_script(target: FrontendTarget) -> Result<String, serde_json::Error> {
    let window_generation = serde_json::to_string(&target.window.get().to_string())?;
    let document_token = serde_json::to_string(&target.document.get().to_string())?;
    Ok(format!(
        "void window.__TAURI_PLUGIN_DECORATION__?.cancel({window_generation},{document_token});"
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        bind_document_script, cancel_script, dispatch_script, init_script, prepare_document_script,
        prepare_script, request_document_ready_script, FrontendOptions, Platform, PreparedFrontend,
        WindowControlPolicy,
    };
    use crate::lifecycle::{FrontendTarget, ReadinessChallenge};

    #[test]
    fn windows_script_preserves_full_width_tokens_and_uses_only_its_adapter() {
        let target = FrontendTarget::from_values(u64::MAX, u64::MAX - 1).unwrap();
        let script = prepare_script(
            target,
            Platform::Windows,
            &FrontendOptions {
                controls: vec!["minimize", "maximize", "close"],
                ..FrontendOptions::default()
            },
        )
        .unwrap();

        let runtime = init_script(Platform::Windows);
        assert!(runtime.contains("__TAURI_PLUGIN_DECORATION__"));
        assert!(runtime.contains("registerPlatform(\"windows\""));
        assert!(!runtime.contains("registerPlatform(\"linux\""));
        assert!(script.contains("\"windowGeneration\":\"18446744073709551615\""));
        assert!(script.contains("\"documentToken\":\"18446744073709551614\""));
        assert!(script.contains("void window.__TAURI_PLUGIN_DECORATION__?.install("));
        assert!(!script.contains(".listen("));
    }

    #[test]
    fn linux_dynamic_values_remain_json_data() {
        let target = FrontendTarget::from_values(1, 2).unwrap();
        let mut options = FrontendOptions {
            controls: vec!["close"],
            ..FrontendOptions::default()
        };
        options.icons.insert(
            "close",
            "data:image/png;base64,YCI7Z2xvYmFsVGhpcy5wd25lZD10cnVlOy8v".to_owned(),
        );

        let script = prepare_script(target, Platform::Linux, &options).unwrap();
        assert!(init_script(Platform::Linux).contains("registerPlatform(\"linux\""));
        assert!(!script.contains("@win-"));
        assert!(!script.contains("innerHTML"));
        assert!(!script.contains("globalThis.pwned"));
    }

    #[test]
    fn macos_script_has_no_custom_control_adapter() {
        let target = FrontendTarget::from_values(1, 2).unwrap();
        let script = prepare_script(target, Platform::Macos, &FrontendOptions::default()).unwrap();

        assert!(!script.contains("registerPlatform(\"windows\""));
        assert!(!script.contains("registerPlatform(\"linux\""));
        assert!(script.contains("\"platform\":\"macos\""));
    }

    #[test]
    fn native_events_dispatch_only_to_the_exact_frontend_target() {
        let target = FrontendTarget::from_values(u64::MAX, u64::MAX - 1).unwrap();
        let script = dispatch_script(target, "snap-mouseenter", &()).unwrap();

        assert_eq!(
            script,
            "void window.__TAURI_PLUGIN_DECORATION__?.dispatch(\"18446744073709551615\",\"18446744073709551614\",\"snap-mouseenter\",null);"
        );
        assert!(!script.contains("emit"));
    }

    #[test]
    fn cancellation_targets_only_the_exact_frontend_installation() {
        let target = FrontendTarget::from_values(u64::MAX, u64::MAX - 1).unwrap();
        assert_eq!(
            cancel_script(target).unwrap(),
            "void window.__TAURI_PLUGIN_DECORATION__?.cancel(\"18446744073709551615\",\"18446744073709551614\");"
        );
    }

    #[test]
    fn document_preparation_is_guarded_by_the_live_document_nonce() {
        let target = FrontendTarget::from_values(7, 9).unwrap();
        let script = prepare_document_script(
            target,
            ReadinessChallenge::from_raw(11).unwrap(),
            Platform::Windows,
            &FrontendOptions::default(),
            "0123456789abcdef0123456789abcdef",
        )
        .unwrap();
        assert!(script.contains("installForDocument(\"0123456789abcdef0123456789abcdef\",\"11\""));
        assert_eq!(
            request_document_ready_script(target, ReadinessChallenge::from_raw(11).unwrap(), 1)
                .unwrap(),
            "void window.__TAURI_PLUGIN_DECORATION__?.challengeDocument(\"7\",\"9\",\"11\",\"1\");"
        );
    }

    #[test]
    fn document_binding_waits_in_the_new_document_until_the_runtime_exists() {
        let script = bind_document_script(u64::MAX).unwrap();
        assert!(script.contains("const lease=\"18446744073709551615\""));
        assert!(script.contains("__TAURI_PLUGIN_DECORATION_DOCUMENT_LEASE__"));
        assert!(script.contains("typeof runtime?.bindDocumentLease"));
        assert!(!script.contains("Finished"));

        let runtime = init_script(Platform::Windows);
        assert!(runtime.contains("const pendingDocumentLease = window[DOCUMENT_LEASE_SLOT]"));
        assert!(runtime.contains("bindDocumentLease(pendingDocumentLease)"));
    }

    #[test]
    fn prepared_frontend_derives_command_policy_from_rendered_controls() {
        let prepared = PreparedFrontend::from_options(
            FrontendOptions {
                controls: vec!["minimize", "maximize"],
                ..FrontendOptions::default()
            },
            Platform::Windows,
        );

        assert_eq!(
            prepared.policy,
            WindowControlPolicy {
                close: false,
                minimize: true,
                snap_geometry: true,
                toggle_maximize: true,
            }
        );
    }

    #[test]
    fn linux_maximize_control_does_not_authorize_windows_snap_geometry() {
        let prepared = PreparedFrontend::from_options(
            FrontendOptions {
                controls: vec!["maximize"],
                ..FrontendOptions::default()
            },
            Platform::Linux,
        );

        assert!(prepared.policy.toggle_maximize);
        assert!(!prepared.policy.snap_geometry);
    }
}
