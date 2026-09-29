# Tauri 3 alpha.3 adaptation

Source: `tauri-plugin-dialog-3.0.0-alpha.1`. Original license notices are retained.

Import `tauri::Manager` in `src/desktop.rs` and `src/mobile.rs`: Tauri alpha.3
provides `run_on_main_thread` through that trait. The dialog implementation and
IPC names remain upstream code, not a replacement implementation.

This snapshot makes clean checkouts reproducible. Remove the local Cargo patch
when an upstream release includes the imports and builds against our Tauri version.

## Upstream

- Issue: https://github.com/tauri-apps/plugins-workspace/issues/3654
- Fix PR: https://github.com/tauri-apps/plugins-workspace/pull/3655 (base `v3`)

Remove this patch once that PR is merged and a `tauri-plugin-dialog` 3.0.0-alpha.2 or
later ships with the import.
