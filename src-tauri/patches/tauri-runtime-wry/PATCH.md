# Mixed-DPI desktop position compatibility

Base: crates.io `tauri-runtime-wry` 3.0.0-alpha.6. Preserve upstream licenses.

On macOS, convert requested physical desktop positions using the destination monitor before passing logical coordinates to Tao. Otherwise restoring a 1x-display position from a 2x display halves the position. This matches the CEF adapter contract.

Regression: `scripts/test-runtime-window-geometry.ts` in the application, run against a Wry candidate with two different-DPI displays. Remove this snapshot when the corresponding upstream release passes the same test.
