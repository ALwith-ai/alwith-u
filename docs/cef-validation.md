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

The application registers `browser_*` tools through the existing application-tool channel.
The `web-automation` feature owns their definitions and model-independent Playwright execution.
A single application-owned Bun worker hosts per-session CDP connections; no browser MCP server
is registered with Codex. The native host supplies scoped credentials internally. Main UI views,
private tabs and browser-wide Target/Browser commands remain excluded. Session cancellation
closes its connections; an ambiguous failure is never automatically replayed.

Native regression: `TAURI_HASGARD_SOCKET=... bun run test:browser-tools`
(`tests/contracts/browser-application-tools.contract.ts`). It verifies application-tool dispatch,
DOM reading, Chinese input, target isolation and credential revocation. `BROWSER_AI_LIVE=1`
additionally uses an isolated test Runtime with an auth-only copy of the existing login and asks
a real model to read a local fixture heading. The in-process fake-agent tests cover tool registration
and explicit session routing for new, resumed and forked conversations without MCP configuration.
