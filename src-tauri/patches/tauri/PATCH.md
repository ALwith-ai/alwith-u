# Primary webview identity patch

Base: the published `tauri` 3.0.0-alpha.6 crate, SHA-256
`4b0cad7bd420aa41bdf7beab9a95e02d83c4cab1cb6f7b94fe4fd1e0c605feaa`.
The compiled sources, manifest, build script, permissions, mobile sources, README
and license notices are retained. Registry metadata and the upstream development
lockfile are omitted; the application owns dependency resolution.

Change: `Manager::get_webview_window`, `Manager::webview_windows` and the
`WebviewWindow` command argument (`src/lib.rs`, `src/webview/webview_window.rs`)
take a window's own webview to be the one whose label is the window's, where
upstream requires the window to hold no other webview. A window that embeds
further webviews, as the browser's tabs are, keeps its `WebviewWindow`.

Removal: when upstream takes the same change on its `v3` line and publishes it,
drop this directory and its `[patch.crates-io]` entry.
