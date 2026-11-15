# Desktop runtimes and browser automation

macOS ARM64 production builds use CEF with SurfaceEmbed. Windows x64 builds use Wry; Windows CEF is currently disabled. Linux distributions are not supported. Both backends share chat, pet, lounge, and floating-window business code.

Use `bun run dev:tauri` for development and `bun run build:desktop` for packaging. On macOS the development command includes both backends. Settings exposes a backend selector with an explicit **Restart and apply** action. Selection persists under the same application identity; changing backend does not move or clear application account storage. Debug CEF builds consistently use an isolated `cef-development` cache and the development mock cookie key, whether launched with Vite, embedded assets or a restart. This does not provide production cookie encryption; release builds retain the OS keychain and a separate profile.

Browser website storage belongs to each engine and is not migrated between engines. Production builds neither display nor permit this setting. Windows always selects Wry.

For direct Cargo use:

```sh
cargo build --no-default-features --features dev-backends,hasgard-testing,tauri/custom-protocol
cargo build --no-default-features --features experimental-cef,tauri/custom-protocol
cargo build --no-default-features --features runtime-wry,tauri/custom-protocol
```

`dev-backends` is accepted only in macOS debug builds. `runtime_capabilities` reports the running backend, `embeddedBrowser`, and `canSwitchBackend`. Wry does not start browser automation or expose guest commands or the browser entry.

## Official Playwright package

The application ships the unmodified `playwright-core` npm package and its notices as resources, alongside a small U-owned stdio tool adapter. Existing bundled Bun executes it; no additional Chromium or native sidecar is installed. Update the pinned package and run the native compatibility test before accepting an upgrade.

Playwright connects through its public `connectOverCDP` API with `noDefaults: true`. An authenticated loopback WebSocket exposes exactly one registered live guest per connection. Root target discovery is virtualized; page and descendant-session messages go to CEF's native DevTools observer. Browser-wide operations (new contexts, closing the application, global permissions/download configuration) are rejected. This is not a general Chrome debugging endpoint and does not advertise full Playwright browser-management compatibility.

Each connection exclusively leases its guest, avoiding competing debugger/domain state. Session revocation disconnects the connection. Closing the tool transport disconnects Playwright without closing the embedded page. The tools provide page reading, locator-based clicks and input, keyboard interaction, selects, navigation, recent console/network diagnostics and scoped low-level CDP. The address bar navigates the existing guest and retains its surface/profile.

## Verification

`bun run check:backends` runs Clippy and Rust tests for Wry, CEF and the dual-backend development build on macOS, and Wry only on Windows. Custom CEF SDK and source patches are still prerequisites. Hosted release jobs remain disabled until those inputs are provisioned; changing platform policy does not make hosted CEF builds ready.

Set `TAURI_HASGARD_SOCKET` for an isolated native candidate and run:

```sh
bun run test:runtime-panels
bun run test:runtime-geometry
bun run test:browser
```

Shell tests require a separate `.contract-test` or `.wry-test` application identity and `ALWITH_U_CEF_SHELL_TEST=1`. Their main window loads `native-shell-test.html`, not the application's login/chat entry. They must not prompt the user to log in or start an agent. Close test candidates after validation. Normal launch must not set the shell-test flag or change profile paths.

Native tests use live pages; screenshots are never substituted for browser surfaces. The Playwright regression verifies actual CEF input, iframe interaction, diagnostics, isolation and revocation without an AI process or user credentials. Mixed-DPI testing needs two displays and restores starting geometry. macOS results do not establish Windows runtime compatibility.

## Website development regression

Run `TAURI_HASGARD_SOCKET=<isolated-candidate-socket> bun run test:browser`
against a contract-test application. The regression uses a temporary Vite project
and verifies hot module replacement without losing input, live navigation and
history, console and HTTP errors, request interception, strict locators, Chinese
input, cross-site frames, native CDP layout inspection, repeated connection
rejection, bundled MCP execution, reconnect and session revocation. No agent
session or user browser profile is used.

The browser tools expose reload, back, forward, locator waits and JavaScript
evaluation in addition to interaction and guest-scoped CDP. History navigation
waits for commit because cached documents need not emit DOMContentLoaded again;
subsequent locator operations still auto-wait for their own readiness.

## Embedded AI browser

The browser is an independent workspace pane with retained live tabs. Ordinary
websites require neither a project nor a development server. `browser_open`
creates a visible tab and acknowledges its registered guest before returning a
target id. Each AI-created tab belongs to its originating conversation. Discovery,
HTTP CDP and Playwright attachment enforce that ownership; tokens for the same
conversation can reconnect. Manually opened tabs are claimed by the first AI
conversation that operates them. The user remains free to operate every tab.

`browser_focus` shows an existing authorized tab; `browser_close` releases its
guest and removes its UI tab. Switching and hiding tabs retain real page state.
The navigation toolbar uses native guest history. Title and URL updates use
native callbacks rather than synchronous URL queries on the CEF UI thread.

Build with `ALWITH_NATIVE_TEST=1 bun run build` and use a contract-test native
candidate with `ALWITH_U_CEF_SHELL_TEST=1 ALWITH_U_CEF_BROWSER_TEST=1` to run the
actual browser pane without authentication or an agent runtime. Run
`TAURI_HASGARD_SOCKET=<socket> bun run test:browser-tabs` to verify concurrent
conversation tabs, retained input, selection, closing and cross-conversation
access rejection. The fixture is excluded from normal frontend builds.

Element inspection returns real DOM, computed styles and geometry. It does not
invent an element-to-source mapping: source locations depend on the website's
debug metadata and source maps. Guest popups become live tabs using the original CEF WebContents. Their
WindowProxy, opener, named-window reuse and browser isolation policies remain
native. Each popup has its own CDP target and inherits the opening conversation's
ownership. Popup tabs are independent: closing an opener, or a tab in between,
leaves the tabs it opened, which keep their own command route and can open
further tabs. Closing the window or the trusted host document closes all its
guests. Run `bun run test:browser-popups`
against the isolated fixture to exercise popup lifecycle and cross-origin messaging.

Tab chrome follows native browser state: loading, progress, session-history
bounds, icons and main-frame load failures are reported by each guest's own
browser, and browser chords pressed inside a page are claimed natively before
page content. Run `bun run test:browser-chrome` against the isolated fixture.
