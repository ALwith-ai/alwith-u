# Migration guide

This guide covers upgrades from the maintained 2.x line and early 3.0
releases to 3.0.5. Applications on 1.x or older should move directly to the
current integration instead of trying to preserve the old frontend contract.

The current release requires Tauri 2.10 or later and Rust 1.88 or later.

## Migrate from 2.x

Version 3 replaced fire-and-forget decoration setup with an awaitable lifecycle.
Update the Rust calls, window visibility, capability, and drag region together.

### API changes

| 2.x | 3.0.5 |
| --- | --- |
| `create_overlay_titlebar()` | `activate_decoration().await` |
| `restore_native_titlebar()` | `restore_decoration().await` |
| Watch a frontend DOM marker | Await the activation result |
| Plugin-owned drag surface | Application-owned `data-tauri-drag-region` |
| General error result | `DecorationError` with `kind()` and `detail()` |
| Synchronous macOS methods | Awaitable macOS methods |
| `set_window_level(u32)` | `set_window_level(i32).await` |
| macOS effects on `WebviewWindowExt` | Effects on `MacOsWindowEffectsExt` |

Remove calls like these:

```rust
window.create_overlay_titlebar()?;
window.restore_native_titlebar()?;
```

Use the complete [`activate_and_show`](integration.md#5-activate-and-recover)
pattern. It keeps the window hidden until activation commits and restores the
native frame before revealing a fallback.

Do not wait for `data-tauri-plugin-decoration-active` in application code. The
`activate_decoration()` future is now the completion boundary.

### Window configuration

Keep these settings:

```json
{
  "decorations": true,
  "visible": false,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true
}
```

Version 2 documentation sometimes enabled `withGlobalTauri` for the embedded
frontend. Version 3 does not need the global Tauri API. Set it to `false` unless
your own application code still depends on `window.__TAURI__`.

Use the current plugin stylesheet origins from the
[integration guide](integration.md#2-configure-the-window-and-csp).

### Capabilities

Version 2 granted broad core window permissions so the embedded frontend could
query and control the window. The current plugin routes its controls through a
closed internal command.

Replace the old plugin-related permissions with:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "decoration:default",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize"
  ]
}
```

Remove these old permissions if no other part of the application uses them:

- `core:window:allow-close`
- `core:window:allow-is-fullscreen`
- `core:window:allow-is-maximized`
- `core:window:allow-minimize`
- `core:window:allow-show`
- `core:window:allow-toggle-maximize`

### Drag regions and layout

The plugin no longer creates a drag plane. Add `data-tauri-drag-region` to
noninteractive titlebar elements and keep interactive controls outside it:

```tsx
<header className="titlebar-content" data-tauri-drag-region>
  <span data-tauri-drag-region>My application</span>
  <button type="button">Menu</button>
</header>
```

Use the platform-neutral clearance properties:

```css
.titlebar-content {
  padding-left: max(
    8px,
    var(--tauri-plugin-decoration-left-clearance, 0px)
  );
  padding-right: max(
    8px,
    var(--tauri-plugin-decoration-right-clearance, 0px)
  );
}
```

Remove the old macOS-only `--decoration-traffic-light-left` property. It is not
published by current releases.

### macOS methods

Traffic-light positioning is now awaitable:

```rust
use tauri_plugin_decoration::WebviewWindowExt;

window.set_traffic_lights_inset(16.0, 20.0).await?;
```

Window level and transparency moved to `MacOsWindowEffectsExt`. Window levels
are signed values:

```rust
use tauri_plugin_decoration::MacOsWindowEffectsExt;

window.set_window_level(3).await?;
```

`make_transparent().await` still requires the `macos-transparency` Cargo
feature. The feature uses Wry's private macOS API and is unsuitable for Mac App
Store distribution.

## Migrate from 3.0.0

The first 3.0 release included `DragRegionMode` and a
`drag_region_mode(...)` builder option. They were removed in 3.0.1. There is no
plugin-provided drag-region compatibility mode.

Delete code like this:

```rust
use tauri_plugin_decoration::DragRegionMode;

let plugin = tauri_plugin_decoration::builder()
    .drag_region_mode(DragRegionMode::PluginProvided)
    .build();
```

Register `init()` or the timeout-only builder, then add application-owned drag
regions and their two Tauri permissions as shown above.

Early 3.0 applications may also use
`--decoration-traffic-light-left`. Replace it with
`--tauri-plugin-decoration-left-clearance`.

## Migrate from 3.0.1 or 3.0.2

Version 3.0.5 raises the minimum Tauri version from 2.9 to 2.10. Update the
application dependency and lockfile:

```toml
[dependencies]
tauri = "2.10.0"
tauri-plugin-decoration = "3.0.5"
```

This baseline includes Wry's live macOS webview transparency implementation.
Applications that call `make_transparent()` need no API change, but they must
keep the `macos-transparency` feature enabled.

No compatibility fixture or fallback remains for Tauri 2.9.

## Verify the migrated application

Check the application itself before release:

- A successful activation reveals the custom titlebar only after the future
  resolves.
- A failed activation restores and reveals a usable native frame.
- Dragging works from noninteractive titlebar content without stealing button
  clicks.
- Windows 11 shows Snap Layout at every supported DPI and browser zoom level.
- macOS traffic lights keep their position through fullscreen transitions.
- Linux is exercised on each Wayland compositor the application intends to
  support.

The [example application](https://github.com/oovz/tauri-plugin-decoration/tree/main/examples/tauri-app)
contains the complete current setup.
