# Integration guide

This guide shows the supported application setup for
`tauri-plugin-decoration` 3.0.5. It assumes Tauri 2.10 or later and Rust 1.88
or later.

The example uses one window named `main`. Repeat the capability and activation
steps for each native window that needs custom decoration.

## 1. Install and register the plugin

Add the crate beside Tauri in `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = "2.10.0"
tauri-plugin-decoration = "3.0.5"
```

Register the plugin before Tauri creates any webviews:

```rust
fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_decoration::init())
        .run(tauri::generate_context!())
}
```

Use `tauri_plugin_decoration::builder()` instead of `init()` only when you need
to change the five-second activation deadline. See [Public API](#public-api).

## 2. Configure the window and CSP

Start with native decorations enabled and keep the window hidden. This gives
the application a usable native frame to restore if custom activation fails.

The embedded stylesheet is loaded through the plugin protocol, so the CSP must
allow its style origins.

```json
{
  "app": {
    "withGlobalTauri": false,
    "security": {
      "capabilities": ["default"],
      "csp": {
        "default-src": "'self' customprotocol: asset:",
        "connect-src": "ipc: http://ipc.localhost",
        "img-src": "'self' asset: http://asset.localhost data:",
        "style-src": "'self' tauri-plugin-decoration: http://tauri-plugin-decoration.localhost https://tauri-plugin-decoration.localhost",
        "style-src-elem": "'self' tauri-plugin-decoration: http://tauri-plugin-decoration.localhost https://tauri-plugin-decoration.localhost"
      }
    },
    "windows": [
      {
        "label": "main",
        "decorations": true,
        "visible": false,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true
      }
    ]
  }
}
```

Do not set `decorations` to `false`. Activation removes the native frame only
after the current document and platform controls are ready.

## 3. Add the capability

Add `decoration:default` to the capability that covers the decorated window.
Application-owned drag regions also need the two Tauri window permissions shown
below.

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main application window",
  "windows": ["main"],
  "permissions": [
    "decoration:default",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize"
  ]
}
```

The plugin's window buttons use a closed internal command. You do not need to
grant the broad close, minimize, maximize, or window-state permissions that
older releases required. Keep any of those permissions that your own frontend
still calls directly.

## 4. Build the application titlebar

The plugin does not create the title text, menus, or drag surface. Mark the
noninteractive parts of your titlebar with `data-tauri-drag-region`:

```tsx
<header className="titlebar-content" data-tauri-drag-region>
  <span className="app-title" data-tauri-drag-region>
    My application
  </span>
  <button type="button">Menu</button>
</header>
```

Draggable elements need `pointer-events: auto`. Do not put
`data-tauri-drag-region` on buttons, inputs, menus, or their ancestors when that
would cover the interactive control.

The plugin publishes these measured values on the document root:

- `--tauri-plugin-decoration-left-clearance`
- `--tauri-plugin-decoration-right-clearance`

Both clearances become `0px` in fullscreen. Use them instead of hard-coding the
width of the platform controls:

```css
:root {
  --tauri-plugin-decoration-titlebar-height: 32px;
  --tauri-plugin-decoration-z-index: 3;
}

.titlebar-content {
  position: fixed;
  inset: 0 0 auto;
  z-index: 2;
  display: flex;
  align-items: center;
  height: 32px;
  padding-left: max(
    8px,
    var(--tauri-plugin-decoration-left-clearance, 0px)
  );
  padding-right: max(
    8px,
    var(--tauri-plugin-decoration-right-clearance, 0px)
  );
  pointer-events: auto;
  user-select: none;
}
```

`--tauri-plugin-decoration-titlebar-height` and
`--tauri-plugin-decoration-z-index` are application settings consumed by the
embedded controls. They are not measured outputs.

The plugin overlays its controls without changing document scrolling. Keep a
fixed titlebar outside the scroll container:

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}

.app {
  --app-titlebar-height: 0px;
  height: 100%;
  overflow: hidden;
}

.app[data-titlebar-mode="custom"] {
  --app-titlebar-height: 32px;
}

.app-content {
  height: calc(100% - var(--app-titlebar-height));
  margin-top: var(--app-titlebar-height);
  overflow-y: auto;
}
```

## 5. Activate and recover

Activation is an asynchronous transaction. Wait for it before showing the
window. If activation or a required macOS adjustment fails, restore the native
frame and reveal that fallback.

```rust
use std::fmt::Display;

use tauri::WebviewWindow;
use tauri_plugin_decoration::WebviewWindowExt;

async fn restore_and_show(
    window: &WebviewWindow,
    activation_error: impl Display,
) -> Result<&'static str, String> {
    let restore_error = window.restore_decoration().await.err();
    let show_error = window.show().err();

    match (restore_error, show_error) {
        (None, None) => Ok("native"),
        (Some(restore), None) => Err(format!(
            "custom decoration failed ({activation_error}); native restoration failed ({restore}), but the window was revealed"
        )),
        (None, Some(show)) => Err(format!(
            "custom decoration failed ({activation_error}); native fallback could not be revealed ({show})"
        )),
        (Some(restore), Some(show)) => Err(format!(
            "custom decoration failed ({activation_error}); native restoration failed ({restore}); revealing the fallback also failed ({show})"
        )),
    }
}

#[tauri::command]
async fn activate_and_show(window: WebviewWindow) -> Result<&'static str, String> {
    if let Err(error) = window.activate_decoration().await {
        return restore_and_show(&window, error).await;
    }

    #[cfg(target_os = "macos")]
    if let Err(error) = window.set_traffic_lights_inset(16.0, 20.0).await {
        return restore_and_show(&window, error).await;
    }

    match window.show() {
        Ok(()) => Ok("custom"),
        Err(error) => restore_and_show(&window, error).await,
    }
}

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_decoration::init())
        .invoke_handler(tauri::generate_handler![activate_and_show])
        .run(tauri::generate_context!())
}
```

Call the application command after the frontend mounts:

```ts
import { invoke } from "@tauri-apps/api/core";

const mode = await invoke<"custom" | "native">("activate_and_show");
// Store `mode` in application state and switch the titlebar layout from it.
```

The plugin does not show the window itself. The application decides how to
report fallback warnings and when the interface is ready to reveal.

## Public API

The `WebviewWindowExt` trait provides the core lifecycle methods:

| Method | Behavior |
| --- | --- |
| `activate_decoration().await` | Prepares the current document, applies native state, and waits for commit |
| `restore_decoration().await` | Cancels pending activation and waits for native restoration |
| `decoration_status()` | Returns `Native`, `Preparing`, `Active`, `Recovering`, or `Failed` |
| `set_traffic_lights_inset(x, y).await` | Positions native macOS traffic lights |

`activate_decoration()` uses a five-second deadline by default. Configure a
different nonzero duration when building the plugin:

```rust
use std::time::Duration;
use tauri_plugin_decoration::builder;

let plugin = builder()
    .activation_timeout(Duration::from_secs(8))
    .build();
```

On macOS, `MacOsWindowEffectsExt` provides the optional
`make_transparent().await` and `set_window_level(...).await` operations. See
[macOS behavior](platforms.md#macos) before enabling transparency.

## Lifecycle and error handling

`activate_decoration().await` resolves only after the current frontend
document and native platform work commit. Concurrent calls join the active
transaction. Navigation or restoration can supersede old work without giving
the old document authority over the new one.

Queued main-thread work can be cancelled when the activation deadline expires.
A native UI-thread call that has already started cannot be interrupted safely,
so its future waits for the authoritative result.

Decoration operations return `DecorationError`. Branch on `kind()` and send
`detail()` to diagnostics.

| Error kind | Typical cause |
| --- | --- |
| `NotInitialized` | The plugin was not registered before webview creation |
| `FrontendUnavailable`, `StylesheetLoad` | The document or embedded stylesheet did not prepare |
| `ActivationTimeout` | Activation exceeded the configured deadline |
| `NativeApply`, `NativeRestore` | A platform mutation or rollback failed |
| `MainThreadSchedule`, `MainThreadTimeout`, `MainThreadPanic` | Event-loop work could not complete |
| `UnsupportedPlatform` | A required backend or optional feature is unavailable |
| `ActionDenied` | The frontend target is outside the supported command boundary |
| `Cancelled` | Newer lifecycle work superseded the request |
| `WindowDestroyed`, `ApplicationShutdown` | The native target no longer exists |

`decoration_status()` describes the lifecycle state. It does not prove native
presentation details such as the Windows 11 Snap Layout flyout.

## Application boundary

The embedded commands accept the native window's primary, same-label webview
on supported local application origins. Tauri and asset URLs are supported, as
are local `localhost`, loopback, and `tauri.localhost` development URLs.
Sibling webviews, remote pages, and arbitrary embedded content are rejected.

For platform-specific behavior and host requirements, continue with
[Platform support](platforms.md). If the application uses an older release,
read the [Migration guide](migration.md) before changing its configuration.
