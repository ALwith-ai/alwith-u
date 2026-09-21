//! Atomic macOS resize, extracted from Desktop's resize_window_edge.
use tauri::WebviewWindow;

pub async fn resize(
    window: &WebviewWindow, direction: String, x: f64, y: f64, width: f64, height: f64,
) -> Result<(), String> {
    if !["North", "South", "West", "East", "NorthWest", "NorthEast", "SouthWest", "SouthEast"]
        .contains(&direction.as_str())
        || ![x, y, width, height].iter().all(|value| value.is_finite())
    {
        return Err("Invalid window resize request".into());
    }
    #[cfg(target_os = "macos")]
    {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let dx = (x - pos.x as f64) / scale;
        let dtop = (y - pos.y as f64) / scale;
        let dw = (width - size.width as f64) / scale;
        let dh = (height - size.height as f64) / scale;
        let anchor_right = direction.contains("West");
        let anchor_top = direction.contains("South");
        let handle = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    let pointer = handle.ns_window().map_err(|e| e.to_string())?;
                    // SAFETY: live window retained on AppKit's main thread.
                    let ns = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
                    let mut frame = ns.frame();
                    frame.origin.x += dx;
                    frame.origin.y -= dtop + dh;
                    frame.size.width += dw;
                    frame.size.height += dh;
                    let min = ns.contentMinSize();
                    let max = ns.contentMaxSize();
                    // Desktop compatibility: AppKit min/max can temporarily cross during mini transitions.
                    let clamp_safe = |value: f64, lo: f64, hi: f64| value.max(lo.min(hi)).min(lo.max(hi));
                    let clamped_width = clamp_safe(frame.size.width, min.width, max.width);
                    let clamped_height = clamp_safe(frame.size.height, min.height, max.height);
                    if anchor_right {
                        frame.origin.x += frame.size.width - clamped_width;
                    }
                    if anchor_top {
                        frame.origin.y += frame.size.height - clamped_height;
                    }
                    frame.size.width = clamped_width;
                    frame.size.height = clamped_height;
                    ns.setFrame_display(frame, true);
                    Ok::<(), String>(())
                })();
                let _ = send.send(result);
            })
            .map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, direction, x, y, width, height);
    }
    Ok(())
}
