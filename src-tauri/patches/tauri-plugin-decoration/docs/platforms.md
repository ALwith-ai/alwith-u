# Platform support

The plugin uses one public lifecycle API on every desktop platform, but the
controls are implemented differently on each host.

| Platform | Controls | Native integration | Support level |
| --- | --- | --- | --- |
| Windows 11 | HTML | Win32 Snap Layout hit target | Supported |
| Windows 10 | HTML | Native window commands | Supported |
| macOS | Native AppKit traffic lights | AppKit positioning and optional effects | Supported |
| Linux | GTK-themed HTML | GTK settings on Wayland | Best effort |

## Windows

Windows uses HTML close, minimize, and maximize buttons. The commands are
handled by the plugin and are restricted to the active decoration on the
native window's primary webview.

### Windows 11 Snap Layout

The Snap Layout flyout needs a native `HTMAXBUTTON` hit target. The plugin
measures the rendered maximize button and titlebar in the webview, converts the
geometry to physical pixels, validates it in Rust, and installs a Win32 overlay
for that bounded region.

The hit target is disabled when:

- the current document is no longer the active decoration owner;
- the maximize control or its containing titlebar cannot be measured;
- the window is fullscreen; or
- the reported geometry is outside the trusted titlebar and control band.

DOM tests cannot prove that the operating system flyout appears. Test the final
application on Windows 11 at every DPI scale and browser zoom level it supports.
Keep CSS transforms and animated movement away from the maximize button unless
you also verify the resulting native hit target.

Windows 10 uses the same HTML controls but does not provide the Windows 11 Snap
Layout flyout.

## macOS

macOS keeps the native AppKit close, minimize, and zoom buttons. The plugin
moves them above application content rather than drawing replacements.

Call the positioning API after activation and before showing the window:

```rust
use tauri_plugin_decoration::WebviewWindowExt;

window.set_traffic_lights_inset(16.0, 20.0).await?;
```

The first argument is the horizontal position of the close button in AppKit
points. The second adds height to the traffic-light container; AppKit centers
the buttons within that container. The operation publishes the resulting left
clearance as `--tauri-plugin-decoration-left-clearance`.

Optional window effects use a separate trait:

```rust
use tauri_plugin_decoration::MacOsWindowEffectsExt;

window.set_window_level(3).await?;
```

Live webview transparency requires the `macos-transparency` feature:

```toml
tauri-plugin-decoration = {
  version = "3.0.5",
  features = ["macos-transparency"]
}
```

```rust
use tauri_plugin_decoration::MacOsWindowEffectsExt;

window.make_transparent().await?;
```

> [!WARNING]
> `macos-transparency` enables Wry's private macOS API. Do not use it for an
> application intended for Mac App Store distribution.

The `make_transparent()` implementation requires Tauri 2.10 or later. That
baseline provides the Wry support needed to update a live macOS webview.

## Linux

Linux support is limited to Wayland and remains best effort. The release
reference profile is Ubuntu 24.04 LTS on x86_64 with a real GNOME
Wayland/Mutter session.

Activation requires:

- GTK 3.24 or later;
- WebKitGTK 4.1;
- a live `GdkWaylandDisplay`; and
- the system packages listed in the
  [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

X11 is unsupported. The plugin returns `UnsupportedPlatform` instead of
silently selecting another display backend.

At activation time, the plugin reads GTK's decoration layout and control icon
artwork, then renders matching HTML controls. Restore and reactivate the
decoration after a GTK theme or `gtk-decoration-layout` change.

Other Linux distributions and Wayland compositors may work, but they are not
release-certified. Automated Linux native E2E runs under headless
Weston/Pixman. That run exercises the Wayland path; it does not replace testing
on the GNOME/Mutter reference profile. XDG shell does not expose observable
minimized state or an unminimize request, so the headless run does not assert
that transition.

## Architecture coverage

The main CI job builds and tests on Windows, macOS, and Ubuntu hosts. A separate
compile job covers these additional Rust targets:

- `aarch64-pc-windows-msvc`
- `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin`

Cross-target compilation checks type and dependency compatibility. It is not a
native UI certification run for that architecture. Applications should run
their own native smoke tests on every operating system and architecture they
ship.

## Shared limitations

- The plugin supports the native window's primary, same-label webview. Sibling
  webviews and remote content cannot own the decoration.
- The application owns titlebar content, drag regions, focus behavior, and the
  scroll layout below the titlebar.
- The plugin controls only its embedded window buttons. Other application
  buttons still need the appropriate Tauri capabilities.
- Fullscreen sets the published control clearances to `0px`. The application is
  responsible for hiding or rearranging its titlebar content.
