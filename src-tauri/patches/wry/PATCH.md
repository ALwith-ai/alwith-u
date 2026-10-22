# WebKit custom-protocol response patch

Base: the published `wry` 0.57.0 crate, SHA-256
`a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0`.
The compiled sources, manifests, build script, examples, README and license
notices are retained. Registry metadata and the upstream development lockfile
are omitted; the application owns dependency resolution.

Backport: [tauri-apps/wry#1856](https://github.com/tauri-apps/wry/pull/1856),
through commit `a1e9973c44f1e6ccb6a1f17a16ded28be26d3ff1`, including
`00e921316f0bee9f2577dc858294bc6268b15ebe`. The crash fix changes the Apple `dispatch2`
dependency and `src/wkwebview/class/url_scheme_handler.rs`. The source
keeps the published crate's import formatting.

## Failure and fix

Worker-thread responses can race WebKit stopping a `WKURLSchemeTask` on the
main thread. A late `didReceiveResponse`, `didReceiveData` or `didFinish`
raises an Objective-C exception. With `panic = "abort"`, the exception can
abort at a Rust boundary before `objc2::exception::catch` intercepts it.
See [wry#1822](https://github.com/tauri-apps/wry/issues/1822).

The patch queues task validation and the entire response sequence together
on the main queue. Already-main-thread responses remain synchronous. Retained
WebKit objects are accessed and released on the main thread, including when
a worker abandons its responder. Abandonment enqueues cleanup asynchronously
so it cannot deadlock a main thread waiting on that worker.

The application-level `[patch.crates-io]` applies to the single Wry instance
used by Tauri, covering IPC and every custom protocol. Public APIs and the
release panic strategy are unchanged.

## macOS 26 baseline

The application supports macOS 26 and later only. Remove the build-host
macOS 12 probe and older macOS runtime branches. Keep iOS availability
checks and the WebKit custom-protocol crash fix. Use current modifier flag
bindings and remove unnecessary unsafe wrappers around safe methods.

## Verification

From `src-tauri`, in a logged-in macOS graphical session:

```sh
cargo tree --locked -i wry
cargo run --locked --release --example wry_protocol_regression
```

The regression uses a real hidden WebKit window through Tauri's Wry dependency.
It checks main-thread and worker response delivery, a late response after a
completed navigation cancels the old task, and a responder abandoned on a
worker. Worker delivery and abandonment must return while the main loop is
paused; the original implementation fails the delivery check. A stale page
callback or missing final page callback also fails the run.

The release run exercises the application's release configuration.
It does not require an account, a sidecar, a development server or network
access. It must be run outside a sandbox that denies WindowServer access.

## Removal

When the resolved upstream Wry version includes this fix (including responder
cleanup), remove the Cargo patch and this snapshot together, update the
application lockfile, and rerun the native regression and application checks.
Do not keep an older local version silently shadowing an upstream update.

## Upstream follow-up — 2026-10-21

Status: waiting for an official release. Wry 0.57.0 remains the latest published
release checked on this date; [PR #1856](https://github.com/tauri-apps/wry/pull/1856)
is still open. Retain this local patch until the resolved official release
contains both serialized response delivery and abandoned-responder cleanup.

- [ ] Verify that an official release includes the complete fix, not only part of the PR.
- [ ] Upgrade within Tauri's supported dependency range. If the fix is still absent,
      update the local base and reapply the required patch instead of dropping it.
- [ ] Run `wry_protocol_regression` against the actual resolved official Wry,
      covering worker delivery, cancellation, and abandoned responders.
- [ ] After verification passes, remove the path override, workspace exclusion,
      and local snapshot together, then refresh Cargo.lock and verify its registry source.

Restored after accidental removal during snapshot cleanup. The application's
minimum supported macOS version remains 26.0. Restoration has not been compiled
or runtime-tested in this maintenance session.

File drops read individual `NSPasteboardTypeFileURL` items and decode file URLs
without the deprecated filename pasteboard type. Drag locations use safe bindings.

Finder file-reference URLs (`file:///.file/id=...`) must be resolved with
Foundation's `NSURL.filePathURL` before extracting a filesystem path. Generic URL
decoding leaves the reference ID as a nonexistent POSIX path and causes dropped
files to fail with `Not a directory`. The shared drag entry/drop collector now
resolves both path and reference URLs before emitting events. Regression tests in
`src/__tests__/dropped_file_url.rs` compile the same resolver and exercise real
Foundation references, renames, Unicode paths, and rejected URLs via
`cargo test --lib dropped_file_url_tests` from `src-tauri`.
