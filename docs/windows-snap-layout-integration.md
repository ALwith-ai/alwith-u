# Windows Snap Layout integration notes

## Finding (2026-11-23, Windows 11, non-maximized window)

The Snap Layout flyout does not appear on the main window because the window
has a 1px non-client inset at the top. The windowing layer adds that inset to
undecorated windows with shadows on Windows 11 (`calculate_insets_for_dpi` in
tao: "without this, the top 1-2 rows of pixels in our window would be
obscured"). With the inset present the shell never queries the window for its
title bar (`WM_GETTITLEBARINFOEX`, 0x033F) and no flyout is shown. With the
inset removed the query arrives and the flyout appears.

The marker used throughout: the top-level window receives one 0x033F shortly
before the flyout appears. It is more reliable than a screenshot.

Evidence:

- Standalone repro mirroring the plugin structure (borderless top-level window
  keeping `WS_CAPTION`, a client-filling child, an overlay child returning
  `HTMAXBUTTON`, a parent subclass returning `HTMAXBUTTON` for the overlay
  rectangle): 0x033F arrives and the flyout shows. Adding per-monitor DPI
  awareness or the application's extended styles changes nothing. Adding a 1px
  top inset in `WM_NCCALCSIZE` stops 0x033F (2 runs with, 4 runs without).
- Running application: a diagnostic switch that restores the proposed top edge
  after the windowing layer's `WM_NCCALCSIZE` produced 0x033F and the flyout on
  the first hover; the same build without the switch did not (1 run each).

Ruled out along the way:

- `tauri-plugin-window-decorations` 0.1.5 overlay geometry, z-order, visibility
  and the parent `HTMAXBUTTON` return value are correct in the running
  application.
- The overlay swallowing `WM_NCMOUSEMOVE` does not prevent the flyout; the
  repro shows it with the message swallowed.
- The plugin's own `TrackMouseEvent` request does not prevent it.
- Hiding the CEF child windows does not bring the flyout back.

## Test pitfalls

- A synthetic click on the title bar drag region before hovering starts a
  window move and the overlay receives no input afterwards.
- A synthetic Alt press to take the foreground puts the window into menu mode.
- Direct `SendMessage(WM_NCHITTEST)` probes return `HTMAXBUTTON` in both the
  failing and the working configuration and cannot detect this failure.

## Where the inset comes from

`winit-win32` 0.31.0-beta.3, `src/event_loop.rs`, `WM_NCCALCSIZE`: an
undecorated window with shadows gets `top += 1; bottom += 1`, so that Windows
still draws the shadow and rounded corners. The CEF runtime builds its windows
on `tauri-winit`, and a Tauri window has shadows by default. Removing the strip
altogether brings the flyout back but makes the corners square.

## Fix

`tauri-plugin-window-decorations` 0.1.6. While the Snap hit target is
installed, the plugin's parent subclass moves a non-client strip that only
offsets the top edge to the bottom edge, and recalculates the frame on install
and removal. A maximized window and a frame that also insets the sides are left
to the windowing layer. U consumes it as `tauri-plugin-window-decorations =
"0.1"` through `Cargo.lock`.

Verified on the CEF backend, Windows 11, 200% scale: non-client insets are
top 0 / bottom 1 from a cold start, rounded corners remain, the flyout appears
on hover, and both hold after maximize and restore.

## Open

- Not verified: the Wry backend (tao insets the sides as well, so the plugin
  leaves that frame unchanged and the flyout is presumably still missing
  there), fullscreen, moving between displays with different scale factors,
  and whether the strip is visible along the bottom edge on some backgrounds.
- Why Windows requires the client area to start at the top edge is not known;
  the title bar information it reports is identical with and without the
  strip.
- The flyout can only be exercised with the real cursor. `hasgard_hover`
  (plugin 0.7.2) raises the DOM hover state without moving the system cursor.
