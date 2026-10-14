# Development guide

This document is for contributors and maintainers working in the repository.
Application developers normally need only the [integration guide](integration.md).

## Toolchain

Install:

- Rust 1.88 or later
- Node.js 24
- pnpm 11.18.0
- the platform prerequisites required by Tauri

Linux builds need the packages listed in the
[Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
Native Linux E2E also needs a Wayland compositor.

Install the JavaScript workspace without changing the lockfile:

```sh
pnpm install --frozen-lockfile
```

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Rust lifecycle, native platform bridges, and embedded frontend assets |
| `permissions/` | Tauri plugin permissions and generated schemas |
| `tests/frontend/` | Fast behavioral tests for the embedded frontend |
| `examples/tauri-app/` | Runnable integration and isolated native E2E build |
| `e2e/` | WebdriverIO configuration, scenarios, and evidence tooling |
| `docs/` | Consumer integration, platform, migration, and development guides |
| `.github/workflows/` | Cross-platform validation, packaging, and release automation |

The root JavaScript package is private workspace tooling. The example and E2E
runner are separate workspace packages; none of their JavaScript dependencies
are shipped with the Rust crate.

## Fast validation

Run formatting, Clippy, Rust tests, frontend tests, and TypeScript checks:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings -D rust-2024-compatibility
cargo test --locked --all-features
pnpm test:frontend
pnpm typecheck:e2e
pnpm --filter tauri-app build
```

The repository lockfiles are part of the validation contract. Keep `--locked`
or `--frozen-lockfile` in reproducible checks.

## Browser E2E

Browser-mode WebdriverIO runs the example frontend with a mocked application
activation command:

```sh
pnpm test:e2e:browser
```

This suite checks markup, focus behavior, clearances, and presentation without
starting a Tauri binary. It does not prove native window behavior.

## Native E2E

Build the isolated E2E application, verify that it launches, then run the native
scenario aggregate:

```sh
pnpm example:e2e:build
pnpm test:e2e:launcher
pnpm test:e2e:native
```

The native runner uses the embedded WDIO provider and does not require a
separate `tauri-driver` installation. On Windows, it checks the installed
WebView2 Runtime and downloads a matching Edge WebDriver when needed. On Linux,
run it with `GDK_BACKEND=wayland` under a Wayland compositor.

Windows has an optional 100-reload navigation scenario. In PowerShell:

```powershell
$env:TAURI_E2E_INCLUDE_NAVIGATION_STRESS = "1"
pnpm test:e2e:native
```

In a POSIX shell:

```sh
TAURI_E2E_INCLUDE_NAVIGATION_STRESS=1 pnpm test:e2e:native
```

The flag is ignored on non-Windows hosts. Navigation stress is included in the
same aggregate instead of running as a second untracked suite.

Native evidence is written under `e2e/artifacts/`:

- `service/native/aggregate.json` records the aggregate result;
- `service/native/<scenario>.json` records per-scenario service metadata; and
- failure, checkpoint, and screenshot directories hold scenario artifacts.

The native runner continues through every selected scenario and returns a
nonzero exit code when any scenario fails.

## Package checks

Build the crate archive and verify that the packaged source compiles:

```sh
cargo package --locked --allow-dirty
```

All Markdown files under `docs/` are included in the crate package. Before
publishing documentation changes, check relative links from both the repository
README and the packaged files.

## CI coverage

The main CI workflow builds and tests on Windows, macOS, and Ubuntu. It also
compiles these extra targets:

- `aarch64-pc-windows-msvc`
- `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin`

Native WDIO is opt-in for ordinary CI runs and is exercised on Windows and
Linux by the release workflow. Linux automation runs under headless
Weston/Pixman, while the Linux release reference remains a real GNOME
Wayland/Mutter session.
