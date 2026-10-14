# tauri-plugin-decoration

[![crates.io](https://img.shields.io/crates/v/tauri-plugin-decoration.svg)](https://crates.io/crates/tauri-plugin-decoration)

Custom titlebars for Tauri v2 applications, with the platform window controls
users expect. The plugin supplies Windows and Linux controls, keeps the native
macOS traffic lights, and preserves the Windows 11 Snap Layout flyout.

Your application still owns the titlebar content, drag region, and page layout.
The plugin's JavaScript and CSS are embedded in the Rust crate, so there is no
companion npm package.

## Platform support

| Platform | Behavior | Support level |
| --- | --- | --- |
| Windows 11 | HTML controls with a native Snap Layout hit target | Supported |
| Windows 10 | HTML window controls | Supported |
| macOS | Native AppKit traffic lights over application content | Supported |
| Linux | GTK-themed HTML controls on Wayland | Best effort |

Linux releases use Ubuntu 24.04 LTS on x86_64 with GNOME Wayland/Mutter as the
reference profile. X11 is not supported. See [platform support](docs/platforms.md)
for backend, architecture, and testing details.

Version 3.0.5 requires:

- Tauri 2.10 or a later compatible Tauri v2 release
- Rust 1.88 or newer

## Get started

### 1. Add the plugin

Add both dependencies to the Tauri application's `Cargo.toml`:

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

### 2. Configure the window

Keep native decorations enabled and start the window hidden. The application
reveals it after custom decoration activation succeeds or the native frame has
been restored.

```json
{
  "app": {
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

Grant the plugin and Tauri's drag-region permissions to the same window:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "decoration:default",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize"
  ]
}
```

### 3. Add your titlebar

Mark only noninteractive titlebar content as draggable. Buttons, menus, and
inputs must remain outside the drag region.

```tsx
<header className="titlebar-content" data-tauri-drag-region>
  <span data-tauri-drag-region>My application</span>
  <button type="button">Menu</button>
</header>
```

Add the copy-ready Rust activation command from
[Activate and recover](docs/integration.md#5-activate-and-recover), then call it
after the frontend mounts:

```ts
import { invoke } from "@tauri-apps/api/core";

const mode = await invoke<"custom" | "native">("activate_and_show");
```

The command waits for frontend and native setup before showing the window. If
activation fails, it restores and reveals the native titlebar instead.

## Try the example

The example application contains the complete configuration, titlebar, and
fallback path:

```sh
pnpm install --frozen-lockfile
pnpm --filter tauri-app build
pnpm example:dev
```

Node 24 and pnpm 11.18 are required to run the repository example. They are not
runtime dependencies of applications that use the crate.

## Limitations

- The plugin decorates the native window's primary, same-label webview. Remote
  pages and sibling webviews are outside the supported command boundary.
- The application owns titlebar markup, drag regions, scrolling, and spacing.
  The plugin publishes control clearances but does not move application content.
- Windows 11 Snap Layout depends on the rendered maximize-button geometry. Test
  the finished application on Windows 11 at every DPI and zoom level you support.
- Linux support requires GTK 3.24, WebKitGTK 4.1, and a live Wayland display.
  Other compositors may work but are not release-certified.
- The optional macOS transparency feature uses Wry's private API and is not
  suitable for App Store distribution.

## Documentation

- [Integration guide](docs/integration.md): configuration, activation,
  permissions, layout, public API, and recovery
- [Platform support](docs/platforms.md): native behavior, architecture coverage,
  and platform-specific limits
- [Migration guide](docs/migration.md): upgrading from 2.x and early 3.0 releases
- [Development guide](docs/development.md): repository setup, tests, native E2E,
  and package checks
- [Example application](https://github.com/oovz/tauri-plugin-decoration/tree/main/examples/tauri-app):
  a runnable integration
