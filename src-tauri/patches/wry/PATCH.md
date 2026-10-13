# WebKit custom-protocol response patch

Base: the published `wry` 0.57.0 crate, SHA-256
`a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0`.
The compiled sources, manifests, build script, examples, README and license
notices are retained. Registry metadata and the upstream development lockfile
are omitted; the application owns dependency resolution.

Backport: [tauri-apps/wry#1856](https://github.com/tauri-apps/wry/pull/1856),
through commit `a1e9973c44f1e6ccb6a1f17a16ded28be26d3ff1`, including
`00e921316f0bee9f2577dc858294bc6268b15ebe`. Only the Apple `dispatch2`
dependency and `src/wkwebview/class/url_scheme_handler.rs` change. The source
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

The release run exercises the application's `panic = "abort"` configuration.
It does not require an account, a sidecar, a development server or network
access. It must be run outside a sandbox that denies WindowServer access.

## Removal

When the resolved upstream Wry version includes this fix (including responder
cleanup), remove the Cargo patch and this snapshot together, update the
application lockfile, and rerun the native regression and application checks.
Do not keep an older local version silently shadowing an upstream update.
