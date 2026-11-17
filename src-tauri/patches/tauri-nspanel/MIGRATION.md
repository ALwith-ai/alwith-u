# Tauri 3 adaptation

Source: https://github.com/ahkohd/tauri-nspanel at
`ef6e3090a6083c653955ca0b6e7f6c6ae1453d40` (v2.1.1). Original license notices are retained.

Local changes update Tauri dependencies and the Wry extension API for Tauri 3.
The existing plugin behavior and IPC names are preserved. This source snapshot
is tracked so a clean checkout can build without sibling repositories.

Tauri 3.0.0-alpha.4 removes the `macos-private-api` feature. The dependency
no longer requests it; window transparency is available without that feature.

Panel conversion and restoration temporarily detach native glass and visual-effect
views before changing the window's Objective-C class, then reattach them in their
original stacking order. AppKit's effect views register KVO on that class; retaining
those registrations across a class change raises `NSRangeException` when a later
effect update removes them. Runtime webview host views remain attached.

Run `cargo test --test panel-effects` from the application's `src-tauri` directory
to check direct and nested materials, both class changes, stacking order and host
retention on AppKit's main thread. The Hasgard `runtime-panel-effects` contract
also exercises the application commands on both CEF and Wry.
