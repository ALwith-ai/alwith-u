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

Frontend commands run from the repository root, Cargo from `src-tauri`:

```sh
bun run build
cargo build --features 'dev-backends,hasgard-testing,tauri/custom-protocol'
```

That, in that order, is the development application; `AGENTS.md` says why no other feature set is
installed. The isolated test application is the same with the test frontend and its own identity:

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
| `bun run test:browser-mcp` | the bundled MCP server | browser fixture |
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
- The last step of `test:browser-mcp` drives a real conversation with the user's Codex login and
  runs only with `BROWSER_AI_LIVE=1`.
- The second step of `test:runtime-geometry` needs two displays of different scale.
