# CEF bootstrap validation

Validated on macOS ARM64 on 2026-11-09, using the local experimental CEF 156 SDK
and matching Release_GN_arm64 component framework. This is a development bootstrap,
not a completed or publishable migration.

## Passed

- Independent checkout and application identity; original ALwith U checkout unchanged.
- Original updater endpoint removed; CEF native entry point and Hasgard adapter selected.
- Installed-package sidecar staging and production frontend build.
- Type checking: 974 files across three projects.
- Script tests: 89 passed. Updated the inherited Vite license patch to match 8.3.7.
- Frontend/engine tests: 260 files, 1,612 tests passed.
- Rust library tests: 234 passed. Clippy with all targets and CEF testing features passed.
- macOS application bundling and ad-hoc signature verification after installing the matching CEF framework.
- Native launch on the secondary display; real ALwith U login screen rendered at tauri.localhost.
- Hasgard reported Chromium 156, selected the email field, delivered native keyboard input,
  verified its value, then deleted it. No form submission or authentication was performed.
- Native IPC explicitly rejected Runtime startup in shell-test mode. No AI session was started.

Local evidence and screenshots live in the external build workspace's
`alwith-u-cef-smoke` directory. Build artifacts live in `alwith-u-cef-target`.

## Remaining

- Integrate the live browser guest with the U interface and AI tool permissions.
- Validate normal authenticated AI sessions using an isolated test Runtime first.
- Port transparent pets, floating/nonactivating panels, native input and Chinese IME.
  The existing WebKit-specific panel assumptions are not validated on CEF.
- Atlas native gestures are deferred.
- The component CEF build emits duplicate Objective-C class warnings; it is not a
  production distribution. Windows compatibility has not been tested.
- `bun lint` is unavailable in the installed stable Bun (the inherited configuration
  requires Canary). Knip reports inherited Storybook files, an obsolete updater fixture
  import, the motion dependency, ShortcutHint export and a stale ignore entry.
- The old WebKit-only protocol regression runner was removed from this CEF checkout;
  native CEF protocol and browser lifecycle coverage must replace it before release.

## Pet panel crash regression

The original WebKit workaround detached CEF's window-handle view before panel
conversion, causing `ns_window()` to panic. CEF views now remain attached.
Winit's effectiveAppearance observer is unregistered and restored across class
conversion, and the original window class is restored before close and application
exit. Without the inverse conversion, AppKit observer teardown could still crash.

`bun run test:runtime-panels` (`tests/contracts/runtime-panels.contract.ts`) runs against an isolated Hasgard shell-test instance.
Five cycles creating and closing both pet and bubble windows passed (ten windows).
Quitting with both windows open completed Runtime shutdown without a new crash
report. This addresses lifecycle crashes, not transparency or full IME parity.

## Feishu live guest candidate

The main workspace now owns a SurfaceEmbed browser pane. It retains the guest
when collapsed, releases it on unmount (including late creation), and uses the
normal workspace layout and popup stacking. No fixed overlay hosts the browser.
The native candidate requires `tauri-runtime-cef/surface-embed` and the local
Tauri primary-webview identity patch in `src-tauri/patches/tauri`.

Feishu's account page rendered its QR sign-in screen in the live guest. Signed-in
messaging and document workflows still require user login and separate testing.
A temporary fixed-overlay fixture was discarded; its assertions are not evidence
for the final workspace integration. Native popup and switching validation must
use the actual workspace pane.

## Internal AI browser tools

The application attaches the `embedded_browser` stdio MCP server through its
existing session-context boundary. Its authenticated loopback transport forwards
commands to the CEF guest's native DevTools agent, without a remote-debugging
port or browser extension. Every request names an app-owned guest; main UI views
and browser-wide Target/Browser commands are excluded. Per-session credentials
must be bound before use and are revoked when session access is released.

Native regression: `TAURI_HASGARD_SOCKET=... bun run test:browser-mcp` (`tests/contracts/browser-mcp.contract.ts`; its last step drives a real conversation and runs only with `BROWSER_AI_LIVE=1`).
It verifies actual stdio MCP initialization, tool discovery, DOM reading,
trusted input dispatch, Chinese text insertion, target isolation and revocation.
`BROWSER_AI_LIVE=1` additionally starts an isolated test Runtime with an auth-only
copy of the existing login and asks a real model to read a local fixture's random
heading. It does not inspect signed-in Feishu content or write to the real chat
store. Read-only MCP tool annotations are required by the read-only agent mode.

Validation for this candidate: 236 Rust tests, 1617 frontend tests and 93 script
tests passed; type checking, Clippy and the frontend build passed. The inherited
lint script is absent and knip still reports previously identified unused items.
Signed-in Feishu workflows have not been claimed as tested.

## Windows x64 candidate (2026-11-16)

Windows uses the same CEF browser and native host interfaces as macOS. Normal
production builds select `experimental-cef`; development builds compile both
backends and keep the `ai.alwith.u.dev` identity when using bundled assets.
Windows settings and runtime preferences use Tauri's existing application data
directory. CEF keeps its default cache directory and Windows encryption mode.
Saved website passwords use Windows Credential Manager; isolated native tests
use a separate identity, a temporary browser profile and memory-only passwords.
The Rust build stages Windows CEF resources from the SDK exposed by the runtime
dependency. Windows disables the bundler's built-in CEF copying and maps those
staged resources into the installation root; its stock file list incorrectly
requires `dxil.dll`, which this SDK does not ship. The staging tests verify the
actual runtime files, all locales, stale-file removal and incomplete-SDK errors.

### Dependency patch

`@nyssance/cef-rs@158.0.25` originally shipped Windows bindings without
SurfaceEmbed. Its Bun patch regenerates Windows x64 C and Rust bindings and
resource identifiers from the published NY CEF Windows SDK. It also fixes runtime
file staging for both Cargo output layouts, including Cargo 1.100's separate
package and fingerprint directories. The application exercises that resolver in
its native browser tests. No package version was changed or published.

SDK archive: `cef_binary_158.0.25+g3ac7d76+chromium-158.0.8127.0_windows64_minimal.tar.bz2`.
Its release index SHA-1 is `afa7ed0926c5ef56f11a7aa9a47a7aeff177d4da`; the
download helper verifies it before extraction. Bindings were generated with
the matching `update-bindings` source and bindgen 0.73.2, then formatted with
rustfmt. C layouts include generated size and field-offset assertions.

### Verified

- Type checking, the normal frontend build, native staging and Knip passed.
- All 287 frontend/engine test files passed: 1,815 tests, run with Bun.
- All 112 browser/settings frontend tests passed independently.
- Build-policy, release-configuration and browser MCP script tests passed.
  The staged-toolchain integration test also passed, including importing the
  browser tools outside the checkout without relying on its `node_modules`.
- Windows Clippy passed for Wry only, CEF only and the combined development
  feature set. The full development candidate was built with
  `dev-backends,hasgard-testing,tauri/custom-protocol`.
- Hasgard connected to the product candidate, reported CEF with embedded-browser
  support, and captured a live website in the actual browser workspace.
  The existing ALwith development account recovered automatically.
- The full-feature development NSIS candidate installed successfully into a
  separate candidate directory. The installed CEF DLL matched the staged SDK's
  SHA-256; Chinese locales and Playwright were present. Hasgard reported Chromium
  158 and the CEF browser capability, and the installed app restored the account
  and website tab. The installed toolchain passed its isolated ACP check.
  This local installer used uncompressed payloads; release compression is unchanged.
- A separate native test identity exercised Chinese input, cross-origin frames,
  navigation, stylesheet/module hot replacement, page isolation, popup ownership,
  bookmarks, native find, permissions and ordinary downloads.
- A unique Windows test credential survived reopening, updated successfully and
  was deleted. Passwords did not appear in the saved login index.
- The scoped Rust browser suite passed 41 tests, including the packaging-stage
  assertions; the credential test is run separately and explicitly.

### Incomplete acceptance

- Hidden SurfaceEmbed tabs do not produce animation frames on Windows even when
  focus emulation reports the document visible and focused. The measured frame
  count stayed at zero until the tab was selected. Consequently, Playwright's
  actionability checks time out in background-tab and nested-popup contracts.
  No forced clicks, synthetic frame timers or screenshot composition were added.
- The full automation contract timed out inside the packaged tool's
  `browser_read_page` after the history/connection sequence. Tracing showed that
  the read remained pending until test teardown; it was not a stdio EOF or
  process-close stall. A separate finite-stdin probe returned all three requested
  tool replies and exited successfully. The native read stall is not yet resolved.
- The browser-chrome contract did not observe the slow download's progress entry.
  Later steps in each failed contract were skipped, not counted as passing.
- The complete Rust library run passed 246 tests, failed two existing Windows
  invalid-path assertions in Drive and Vibemon, and ignored the explicitly run
  credential test. Those failures are outside the browser changes.
- The complete script suite has five Windows environment/path failures in release
  download and Storybook catalog tests. The installed Bun has no `lint` command.
- macOS native regression tests were not run on this Windows machine. The upstream
  CEF runtime also documents that its Windows executable integration cannot yet
  enable Chromium's process sandbox.

These results establish Windows CEF integration, not complete native parity or
release approval.
