# Embedded browser: building and testing

How the embedded browser's native side is obtained and how its behaviour is checked. What the
modified CEF does inside, and how it is built, is documented with its source and is no part of this
repository.

## Where the native side comes from

- The CEF runtime and the bindings to the CEF build it needs are the npm packages
  `@nyssance/tauri-runtime-cef` and `@nyssance/cef-rs`, which `bun install` puts in `node_modules`;
  `src-tauri/Cargo.toml` patches the crates from there under `[patch.crates-io]`. Nothing else is
  needed to build. To take a newer runtime and bindings, move both to the same exact version.
- The patched `tauri` crate is vendored in `src-tauri/patches/tauri`; `PATCH.md` there says what it
  changes and when it can go.
- `tauri-plugin-hasgard` comes from crates.io.
- The CEF build itself is downloaded by the bindings when they are built: the release of their
  own version at `github.com/nyssance/ny-cef`, verified by its checksum. Nothing is configured
  for it. The bindings, the runtime and the CEF build must be of the same version; a stock CEF does
  not have the interfaces the runtime calls.
- Someone changing CEF itself names their own build with `CEF_SURFACE_SDK` in an untracked
  `src-tauri/.cargo/config.toml`, and stages it into a bundle with `scripts/cef-framework.ts`
  (`CEF_DIR` for a distribution, `CEF_SURFACE_BUILD` besides for a component build's output
  directory).

## Building

Build a bundled development candidate with the same API environment and application identity
as `bun dev:tauri`:

```sh
bun run build:desktop --debug
```

This uses Tauri's existing build lifecycle to stage resources and build the frontend, then builds
Cargo with `tauri.dev-instance.conf.json` and `dev-backends,hasgard-testing,tauri/custom-protocol`.
The frontend reads Tauri's debug-build flag and selects the development API environment.
Account credentials remain scoped to the selected API environment; building does not move
or copy credentials between environments.

The isolated test application uses the test frontend and its own identity. Frontend commands
run from the repository root, Cargo from `src-tauri`:

```sh
ALWITH_NATIVE_TEST=1 bun run build
TAURI_CONFIG='{"identifier":"ai.alwith.u.contract-test"}' \
  cargo build --features 'dev-backends,hasgard-testing,tauri/custom-protocol'
```

Rebuild the normal frontend and binary afterwards. Never install a test build as the development
application, and never run a contract against a user's own session.

## Contracts

The contracts are vitest suites in `tests/contracts/` (`*.contract.ts`, configuration
`vitest.contracts.config.ts`, fixtures beside them). They are no part of `vitest run`: they drive a
launched test application over its Hasgard socket, named in `TAURI_HASGARD_SOCKET`.

| Command | Covers | Test application |
| --- | --- | --- |
| `bun run test:browser` | automation through the bundled tools and Playwright | browser fixture |
| `bun run test:browser-tabs` | tabs of separate conversations | browser fixture |
| `bun run test:browser-popups` | windows a page opens | browser fixture |
| `bun run test:browser-chrome` | history, find, menus, permissions, downloads, failures, chords | browser fixture |
| `bun run test:browser-everyday` | arranging tabs, private tabs, logins, restore, groups, crashes | browser fixture |
| `bun run test:browser-tools` | the application-owned web executor | browser fixture |
| `bun --bun node_modules/vitest/vitest.mjs run --config vitest.contracts.config.ts tests/contracts/browser-business.contract.ts` | cross-origin editing, attachments, dialogs, and business controls | browser fixture |
| `bun run test:browser-extensions` | extensions | browser fixture with `ALWITH_U_CEF_TEST_EXTENSION` pointing at `tests/contracts/fixtures/browser-extension` |
| `bun run test:runtime-panels` | panel windows, on either backend | shell test (`ALWITH_U_CEF_SHELL_TEST=1`) |
| `bun run test:runtime-geometry` | window geometry, on either backend | shell test |

`bun run test:contracts` runs them all against whichever application is running; vitest's `-t`
picks steps by name. The browser fixture is the test application launched with
`ALWITH_U_CEF_SHELL_TEST=1`, `ALWITH_U_CEF_BROWSER_TEST=1`, a disposable
`ALWITH_U_CEF_TEST_PROFILE` and `TAURI_HASGARD_DISPLAY=secondary`.

What to know when running them:

- Each behaviour is a named step. The steps of a contract build on one another in one application,
  so a failed step ends the run. After it the contract prints what the application was showing
  (`reportFailure` in `tests/contracts/lib/app.ts`): the tabs, the address, the size of the page's
  surface, pending prompts and whatever lay over the page.
- A contract moves windows on the screen for as long as it runs. Do not loop one while someone is
  using the machine.
- The browser grants fullscreen only to the application holding the focus, and a contract never
  takes the focus: that step is skipped, and says so, when the test application is not in front.
- A permission prompt is shown only for a visible page, so the screen must be unlocked.
- `test:browser-everyday` expects a freshly launched test application: the tabs it closes stay in
  the application's list of recently closed tabs, and a second run in the same application finds
  them when it searches.
- The extension test profile keeps the worker it first registered. After changing the fixture's
  worker, remove `Default/Service Worker` from that profile.
- The last step of `test:browser-tools` drives a real conversation with the user's Codex login and
  runs only with `BROWSER_AI_LIVE=1`.

- The second step of `test:runtime-geometry` needs two displays of different scale.

## Website tasks through conversations

The browser tools operate the same live website and profile the user sees. They do not need
desktop screenshots, screen coordinates, or a website-specific API. Read a page before acting;
its `frames` inventory supplies the frame ids accepted by element tools, including cross-origin
editors. Detached frames fail instead of silently redirecting input to the main document.

`browser_read_page` supports a scoped selector and paginated text (`nextOffset`). Its accessible
tree is bounded and reports truncation; narrow the selector when more detail is needed.
`browser_read_elements` paginates matching controls or rows and returns their current values,
checked state, and attached files. Virtualized tables still require scrolling and rereading.

Editing activates the control before entering text and returns the observed value. Replacement
operations also report `matchesRequestedText`; a mismatch is not a successful edit. Password
values are not returned. `browser_upload` sets an observed file input from existing absolute
paths, including hidden attachment inputs listed by the page read. The website's own upload or
submission status must still be checked.

When an action opens a JavaScript dialog, its reply contains `pending: true` and the dialog's
id, type, and message. `browser_dialog` answers that exact dialog and resumes observation of
the original action. Do not click Send or Submit again to continue it. Read the resulting page
status before claiming the business operation completed, and inspect before retrying an
ambiguous submission.

The business contract submits only to a local fixture server, checks the received reply and
attachment bytes, and verifies that dismissing confirmation does not submit again. For a
Chromium-only check, set `BROWSER_BUSINESS_HEADLESS=1` on its command. That check does not
establish CEF parity or support for any particular production website. Run the same contract
against the isolated CEF application for the native boundary. Wry has no embedded browser.

## Web automation feature

`src/features/web-automation` separates application-tool definitions, Playwright execution and
the application worker protocol. The chat client registers its tools through `applicationTools`;
it does not attach an embedded-browser MCP server. The native host owns the worker, supplies
per-session CDP credentials and releases connections on cancellation or session revocation.
Playwright remains outside the UI bundle and continues to use the live CEF pages.

## Structural references and verified outcomes

`browser_snapshot` uses Playwright's public AI snapshot API, including nested frames and
shadow DOM. It returns bounded text, a unique `snapshotId`, and actionable `ref` values.
Element tools accept either an observed selector with an optional frame, or a ref and its
snapshot ID. References are scoped to the attached target and current snapshot. Navigation,
a replacement snapshot, removed elements, or changed accessible identity require a fresh
observation. Password values are removed from structural snapshots. A screenshot replaces
the current structural reference context; take a fresh snapshot before returning to refs.

`browser_verify` uses Playwright's retrying assertions for visible/hidden state, visible text,
field values, checked state, element counts and exact URL. A successful assertion confirms
only that condition. Verify a site's saved status or reopen its record before claiming a
business task is complete. A timeout never automatically replays the mutation.

Known sequences can run through the agent's existing code mode, awaiting each application
tool call. Concurrent calls on one target are rejected rather than racing page observations
and edits. Independent targets can progress independently. Stop a sequence when an operation
fails or returns a pending dialog; the original action continues through `browser_dialog`.
`browser_resolve` returns upstream semantic locator code for reusable workflow instructions;
revalidate its preconditions on subsequent runs.

## Visual-only content and downloads

`browser_screenshot` returns an image content item, not base64 text for the model to decode.
An optional observed element crops the image to its visible viewport region. Images use CSS
pixel scale, including on high-DPI displays. `browser_visual` uses coordinates relative to that
image and requires its target-local, single-use `imageId`. Changed navigation, viewport,
scroll position or accessibility structure invalidates the capture; captures expire after
30 seconds. Canvas-only changes may not appear in the structural check: inspect a current
image and verify the action's outcome. Use visual actions only when structural operations
cannot express the task.

`browser_download` clicks the designated control, waits for its download and saves it to an
explicit absolute path without overwriting an existing file. The response reports the saved
path and byte count. CEF completion comes from the authorized guest's native download state;
the original remains in Downloads and its path is returned as `sourcePath`. Other Chromium
connections use Playwright's download events and report the suggested filename.
An uncertain download failure requires inspection, not
an automatic second click.

Run the generic observation contracts with:

```sh
bun --bun node_modules/vitest/vitest.mjs run --config vitest.contracts.config.ts tests/contracts/browser-observation.contract.ts
```

These isolated Chromium checks are separate from the native CEF application-tool contracts.
They do not establish support for every production website or comparative agent performance.
