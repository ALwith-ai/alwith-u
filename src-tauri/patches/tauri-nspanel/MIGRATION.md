# Tauri 3 adaptation

Source: https://github.com/ahkohd/tauri-nspanel at
`ef6e3090a6083c653955ca0b6e7f6c6ae1453d40` (v2.1.1). Original license notices are retained.

Local changes update Tauri dependencies and the Wry extension API for Tauri 3.
The existing plugin behavior and IPC names are preserved. This source snapshot
is tracked so a clean checkout can build without sibling repositories.

Tauri 3.0.0-alpha.4 removes the `macos-private-api` feature. The dependency
no longer requests it; window transparency is available without that feature.
