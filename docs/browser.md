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

The binary Cargo builds cannot run where it is: CEF is loaded from `../Frameworks` beside the
executable, with its helper applications, and those exist only in an application bundle. One
command bundles the test application from the working tree, starts it with its own identity and
a disposable profile, runs contracts against it, stops it and rebuilds the ordinary frontend:

```sh
bun run contracts browser tests/contracts/browser-application-tools.contract.ts
bun run contracts shell tests/contracts/runtime-panels.contract.ts
```

`browser` is the browser fixture and `shell` the shell test of the table below; what follows is
passed to vitest, and nothing runs every contract. The bundle is `ALwith U Contract Test.app` in
`src-tauri/target/debug/bundle/macos`, apart from the other bundles there. Only one test
application runs at a time: a second one hands over to the first and exits, and the command
then fails saying so. A contract that needs more environment, such as
`ALWITH_U_CEF_TEST_EXTENSION`, takes it from the environment of the command.

To start the test application by hand, start the executable inside that bundle with
`ALWITH_U_CEF_SHELL_TEST=1`, `ALWITH_U_CEF_BROWSER_TEST=1` for the browser fixture, a disposable
`ALWITH_U_CEF_TEST_PROFILE`, `TAURI_HASGARD_DISPLAY=secondary` and a `TAURI_HASGARD_SOCKET`; it
is ready when the socket exists and its main window shows the fixture's page.

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
paths, including hidden attachment inputs listed by the page read. Named a control that is not a
file input, it presses it and answers the file chooser that opens, without the system's dialog:
websites often make the input when Attach is pressed and never put it in the page. The website's own upload or
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

## A tab a conversation works on

A tab under a conversation's control keeps being drawn and keeps its size, whatever the reader is
looking at. Two things used to stop that:

- A tab behind the shown one was hidden with `visibility: hidden`. A hidden surface whose page
  repaints (a caret in a field is enough) is given about two frames a second, and Playwright waits
  for frames before every action: each one took over a second. Such a tab is now moved out of
  sight inside the clipped tab area instead. A tab nobody works on is hidden as before.
- A closed browser pane is no wider than nothing, and so was the page in it: an action could not
  land and timed out. While a conversation works in a tab, the workspace keeps the size it was
  last shown at inside the closed pane, which clips it.

Neither changes what the reader sees. `tests/contracts/browser-working-tabs.contract.ts` checks
both in the isolated CEF application, and
`src/features/browser/__tests__/browser-working-tabs.test.tsx` the layout rules. Measured on
macOS in the released 26.11.25 before the change: a tab behind got 1 to 2 frames in half a second
against 38 for the shown tab, and a pointer move on it took 1.4 to 1.9 seconds against 30 to 50
milliseconds; with the pane closed its width was 0 and every action timed out.

Keeping such tabs drawn has a price. Measured in the debug test application on macOS with five
tabs each running a one-second CSS rotation and a `requestAnimationFrame` counter at 75 frames a
second: all five worked on used about 42% of one core, and with the four behind released and
hidden, about 30%. Three per cent of a core for a tab that animates without pause, and only while
a conversation holds it.

## A page or a script that never answers

Nothing else may act on a target while a call to it is out, and a navigation that has not arrived
holds every command to the document the tab shows. Three things used to leave a tab unusable for
the rest of a conversation, each measured in the released 26.11.25:

- `browser_navigate` to a website that never answers ran out of its twenty seconds, and the
  navigation stayed pending: the next `browser_evaluate` never returned, and every call after it
  was refused as busy.
- A followed link to such a website: the click, then every later call, ran out of time.
- `browser_evaluate` had no limit. An expression that never finished held the tab for good.

A navigation that runs out of time is now stopped, and the error says which document the tab still
shows. A call that runs out of time while the tab is on its way somewhere stops that navigation
and says so; nothing is done again on its behalf, because what it did before then may have
happened. An expression gets thirty seconds and is then terminated. After each, the next call
answers at once. `tests/contracts/browser-held-pages.contract.ts` covers the three.

## What a tab is told before it is registered

A guest is registered once its surface has a token to embed it by, a moment after it is created.
A page from the cache or a resumed history has loaded by then, and said so: that it stopped
loading, and whether there is a page to go back or forward to. That is said once. It used to be
dropped for want of a registered guest, so a tab copied from one with pages ahead of it showed
Forward disabled although its history was whole. What a guest is told while it is being created
is now kept and folded into its state when it is registered, under the lock its title already
used for the same reason. `tests/contracts/browser-everyday.contract.ts` (a copied tab keeps its
history) failed three runs in three before this and passes now.

## Structural references and verified outcomes

`browser_snapshot` uses Playwright's public AI snapshot API, including nested frames and
shadow DOM. It returns bounded text, a unique `snapshotId`, and actionable `ref` values.
A snapshot is for finding what to act on, so one node shows at most 200 characters of text
followed by `[+N chars]`: a long article no longer uses the whole budget and hides the controls
after it. `browser_read_page` with a selector reads the text whole. An editable element shows the
text it holds, which Playwright's snapshot leaves out. A frame that arrives while the page is
being read makes the reading stale; the snapshot reads again, for up to five seconds, before it
reports that the page navigated.

`browser_open` answers once the new tab's document can be read, as `browser_navigate` does, so
the first observation does not find the page still arriving. A page that opens a dialog while it
loads is answered with that dialog pending; one that cannot be reached is an error naming the
tab, which stays open.
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

## Navigation is limited to websites

A tab driven by a conversation navigates to `http:` and `https:` addresses only. The rule is
enforced where a conversation opens a tab (`browser_ai.rs`), where it navigates one
(`cef_runtime.rs`), and for `Page.navigate` on the tab's DevTools connection
(`browser_protocol.rs`); each refuses with `Navigation requires HTTP(S)`. It keeps a
conversation, or a page that has misled it, from reading local files through `file:`, opening
the browser's own `chrome:` and `devtools:` pages, or running code through `javascript:` and
`data:` addresses. The rule admits two schemes instead of refusing a list of dangerous ones, so
`about:blank` is refused as well: a tab cannot be made blank.

## Running a Playwright script

`browser_run` runs a script file or module source against one tab. A script started as a
command cannot launch a browser: the command sandbox on macOS stops Chrome while it registers
with Launch Services, and it aborts.

- **Authority.** Codex sends the session's sandbox state with each call to a tool server that
  asks for it (`codex/sandbox-state`); the chat package asks and hands the state to the tool
  unchanged. `script-runner.mjs` starts the script through `codex sandbox --sandbox-state-json`
  with that state, in the session's working directory, so the script has the permissions of the
  conversation's commands. A call without a state is refused, and a state written by the model
  is replaced by the engine's.
- **The tab.** The sandbox gets one addition: a Unix socket in a private directory
  (`--allow-unix-socket`). The application's worker serves it and rewrites the first request of
  each connection to the DevTools path of the tab the call names, adding the credential. The
  script cannot reach another tab, the browser's own port, or the network.
- **Playwright.** `script-shim.mjs` is loaded before the script. Launching or connecting to
  Chromium gives the tab; a new page is that tab again with the context's viewport; closing a
  page leaves the tab open. Because a tab cannot be made blank, a new page still shows the
  document the tab had: a script that reads a page before navigating reads that document. The
  script gets the Playwright shipped with the application whatever the project installs; the
  runner does this with `--tsconfig-override`, so path aliases of the project's `tsconfig` do
  not apply inside a script.
- **Not available.** Firefox, WebKit and the `playwright test` runner, which starts its own
  browsers.
- **Tests.** `scripts/lib/__tests__/script-runner.test.ts` runs with `bun run test` and checks
  the arguments, the tab a script is bound to and that the credential stays out of the script,
  against a stand-in connection. The real sandbox is checked by the `browser_run` step of
  `tests/contracts/browser-application-tools.contract.ts` (`bun run test:browser-tools`): the
  test application provides the tab and the step calls the tool with a restricted sandbox state
  (two viewports with an action, an assertion and a screenshot each; the script's own TCP
  connections to the browser's port and to the page's server, and a write outside the working
  directory, are refused; a script past its time limit is stopped). No test starts a browser of
  its own: a browser started by a test inherits the sandbox of whoever ran the tests, and macOS
  aborts it while it registers, which is what `bun run test` did from inside a conversation
  until 2026-11-25. Contracts are not part of `fab check`: before a release that changes `browser_run`, the
  runner or the shim, run `bun run contracts browser tests/contracts/browser-application-tools.contract.ts`.
- **Verified.** On macOS, in the running application through the chat entry (two viewports,
  assertions, screenshots; the script's own TCP connection and a write outside the working
  directory were both refused), and by the contract step above against the bundled test
  application (2026-11-25: all eleven steps of `test:browser-tools` passed, the conversation
  with a real model skipped). Windows has not been run: the socket and
  the Windows sandbox are unverified there, and a failure to set them up is reported, never
  replaced by an unsandboxed run.
