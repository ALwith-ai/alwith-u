use crate::frontend::ControlLayout;
use std::collections::HashSet;

#[cfg(target_os = "linux")]
use crate::{frontend::FrontendOptions, DecorationError};
#[cfg(target_os = "linux")]
use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(target_os = "linux")]
use gtk::prelude::*;
#[cfg(target_os = "linux")]
use tauri::{Runtime, WebviewWindow};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Backend {
    Wayland,
}

pub(crate) fn backend_from_type_name(type_name: &str) -> Result<Backend, String> {
    match type_name {
        "GdkWaylandDisplay" => Ok(Backend::Wayland),
        _ => Err(format!(
            "custom Linux decorations require a GdkWaylandDisplay, found {type_name:?}"
        )),
    }
}

pub(crate) fn bounded_scale(scale: i32) -> i32 {
    scale.clamp(1, 4)
}

pub(crate) fn parse_decoration_layout(
    value: Option<&str>,
    available: &[&'static str],
) -> Result<ControlLayout, String> {
    let Some(value) = value else {
        return Ok(ControlLayout {
            left: Vec::new(),
            right: available.to_vec(),
        });
    };

    let mut sections = value.split(':');
    let left = sections.next().unwrap_or_default();
    let Some(right) = sections.next() else {
        return Err("GTK decoration layout must contain exactly one ':' separator".to_owned());
    };
    if sections.next().is_some() {
        return Err("GTK decoration layout must contain exactly one ':' separator".to_owned());
    }

    let mut seen = HashSet::new();
    let mut parse_side = |side: &str| {
        side.split(',')
            .filter_map(|raw| {
                let control = match raw.trim() {
                    "minimize" => "minimize",
                    "maximize" => "maximize",
                    "close" => "close",
                    _ => return None,
                };
                (available.contains(&control) && seen.insert(control)).then_some(control)
            })
            .collect::<Vec<_>>()
    };
    let left = parse_side(left);
    let right = parse_side(right);
    Ok(ControlLayout { left, right })
}

#[cfg(target_os = "linux")]
const ICON_CANDIDATES: [(&str, &[&str]); 4] = [
    ("minimize", &["window-minimize-symbolic", "window-minimize"]),
    ("maximize", &["window-maximize-symbolic", "window-maximize"]),
    ("restore", &["window-restore-symbolic", "window-restore"]),
    ("close", &["window-close-symbolic", "window-close"]),
];

#[cfg(target_os = "linux")]
fn load_icon_data_url(
    theme: &gtk::IconTheme,
    style_context: &gtk::StyleContext,
    candidates: &[&str],
    scale: i32,
) -> Option<String> {
    for candidate in candidates {
        let Some(icon) =
            theme.lookup_icon_for_scale(candidate, 16, scale, gtk::IconLookupFlags::FORCE_SIZE)
        else {
            continue;
        };
        let Ok((pixbuf, _was_symbolic)) = icon.load_symbolic_for_context(style_context) else {
            continue;
        };
        let Ok(png) = pixbuf.save_to_bufferv("png", &[]) else {
            continue;
        };
        return Some(format!("data:image/png;base64,{}", STANDARD.encode(png)));
    }
    None
}

#[cfg(target_os = "linux")]
pub(crate) fn frontend_options<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<FrontendOptions, DecorationError> {
    let gtk_window = window
        .gtk_window()
        .map_err(|error| DecorationError::native_apply(error.to_string()))?;
    let display = gtk_window.display();
    let display_type = display.type_();
    backend_from_type_name(display_type.name()).map_err(DecorationError::unsupported_platform)?;

    let mut controls = vec!["minimize"];
    if gtk_window.is_resizable() {
        controls.push("maximize");
    }
    if gtk_window.is_deletable() {
        controls.push("close");
    }

    let screen = gtk::prelude::GtkWindowExt::screen(&gtk_window)
        .ok_or_else(|| DecorationError::native_apply("GTK window has no associated screen"))?;
    let settings = gtk::Settings::for_screen(&screen)
        .ok_or_else(|| DecorationError::native_apply("GTK screen has no effective settings"))?;
    let configured_layout = settings.gtk_decoration_layout();
    let layout = parse_decoration_layout(configured_layout.as_deref(), &controls)
        .map_err(DecorationError::native_apply)?;
    let controls: Vec<&'static str> = layout
        .left
        .iter()
        .chain(layout.right.iter())
        .copied()
        .collect();

    let mut icons = std::collections::BTreeMap::new();
    if let Some(theme) = gtk::IconTheme::for_screen(&screen) {
        let scale = bounded_scale(gtk_window.scale_factor());
        let style_context = gtk_window.style_context();
        for (control, candidates) in ICON_CANDIDATES {
            if let Some(data_url) = load_icon_data_url(&theme, &style_context, candidates, scale) {
                icons.insert(control, data_url);
            }
        }
    }

    Ok(FrontendOptions {
        controls,
        icons,
        layout: Some(layout),
        ..FrontendOptions::default()
    })
}

#[cfg(test)]
mod tests {
    use super::{backend_from_type_name, bounded_scale, parse_decoration_layout, Backend};
    use crate::frontend::ControlLayout;

    const ALL_CONTROLS: &[&str] = &["minimize", "maximize", "close"];

    #[test]
    fn effective_layout_preserves_left_and_right_sides() {
        assert_eq!(
            parse_decoration_layout(Some("close:minimize,maximize"), ALL_CONTROLS).unwrap(),
            ControlLayout {
                left: vec!["close"],
                right: vec!["minimize", "maximize"],
            }
        );
        assert_eq!(
            parse_decoration_layout(Some("close,minimize,maximize:"), ALL_CONTROLS).unwrap(),
            ControlLayout {
                left: vec!["close", "minimize", "maximize"],
                right: vec![],
            }
        );
    }

    #[test]
    fn layout_ignores_menu_tokens_filters_unavailable_controls_and_deduplicates() {
        assert_eq!(
            parse_decoration_layout(
                Some("menu,close:minimize,maximize,close,appmenu"),
                &["minimize", "close"],
            )
            .unwrap(),
            ControlLayout {
                left: vec!["close"],
                right: vec!["minimize"],
            }
        );
    }

    #[test]
    fn missing_layout_uses_a_deterministic_right_side_fallback() {
        assert_eq!(
            parse_decoration_layout(None, &["minimize", "close"]).unwrap(),
            ControlLayout {
                left: vec![],
                right: vec!["minimize", "close"],
            }
        );
    }

    #[test]
    fn valid_control_free_layouts_are_preserved_after_filtering() {
        for layout in [":", "menu,appmenu:", "maximize:"] {
            assert_eq!(
                parse_decoration_layout(Some(layout), &["close"]).unwrap(),
                ControlLayout::default(),
            );
        }
    }

    #[test]
    fn malformed_layout_still_fails() {
        assert!(parse_decoration_layout(Some("close:minimize:extra"), ALL_CONTROLS).is_err());
    }

    #[test]
    fn only_a_real_wayland_display_enables_custom_linux_decorations() {
        assert_eq!(
            backend_from_type_name("GdkWaylandDisplay").unwrap(),
            Backend::Wayland
        );
        for unsupported in [
            "GdkX11Display",
            "GdkBroadwayDisplay",
            "GdkQuartzDisplay",
            "FutureDisplay",
        ] {
            assert!(backend_from_type_name(unsupported).is_err());
        }
    }

    #[test]
    fn icon_scale_is_bounded_before_theme_rasterization() {
        assert_eq!(bounded_scale(-1), 1);
        assert_eq!(bounded_scale(1), 1);
        assert_eq!(bounded_scale(2), 2);
        assert_eq!(bounded_scale(99), 4);
    }
}
