# Distribution of U's closed-source dependencies

U's source can be public. Private implementations such as Auth are not published with it, and building U needs no access to private repositories.

| Layer | What U uses | Needs private source |
| --- | --- | --- |
| Frontend API, chat, account interface | `@alwith/api`, `@alwith/module-chat`, `@alwith/module-auth` from npm | No |
| Native Auth refresh, app discovery | `@alwith/native`, which picks the platform dynamic library | No |
| Tauri | The thin C ABI bridge in `src-tauri/src/native.rs` | No; it holds no Auth implementation |
| Agent hosting | A pinned Runtime binary | No |

`bun install` installs the dependencies, `bun run stage` verifies and copies the native artifacts and their licences, and `bun run tauri build` uses the same staging chain. For a cross-architecture build run `bun install --os='*' --cpu='*'` first, then pass the target triple.

The native libraries are produced by the CI of the private alwith-modules repository, with arm64 and x64 artifacts for macOS, Windows and Linux. A platform package contains only the dynamic library, `artifact.json` and licence notices; no Auth Rust source. The build scripts of `@alwith/native` never run in the WebView.

## Unchanged behaviour

- Auth stays separate from the Runtime; no new resident process.
- Refresh is still coalesced by the shared Rust implementation; windows of one app share refresh state.
- U and Desktop each keep their own JSON credentials; token files are neither migrated nor shared.
- The npm publishing account has nothing to do with end users' ALwith login.
- The desktop dynamic libraries are not mobile artifacts; iOS and Android support cannot be claimed.

## Acceptance boundary

A passing local Cargo build does not mean distribution is done. The final check must run in a separate directory using public npm and an anonymously downloadable Runtime, without copying local binaries, `node_modules` or private repositories. Each platform is judged by its actual CI result; signing, notarisation and integration with real accounts are accepted separately.

## Current release scope (2026-09-16)

- The native libraries and the Runtime are both npm platform packages (`@alwith/native`, `@alwith/runtime`, five platforms each: macOS arm64, Linux x64/arm64, Windows x64/arm64, no Intel Mac), published by each repository's CI through trusted publishing with versions matching the repository tag.
- At build time `stageNative()` / `stageRuntime()` verify the SHA256 pinned in the platform package before copying into resources and sidecars. No GitHub token is read, no file is requested from a private repository, and no neighbouring checkout is borrowed implicitly (`RUNTIME_SOURCE=sibling` and `RUNTIME_PATH` are explicit development overrides).
- Verified in an isolated macOS ARM64 directory: public dependency install, full staging, TypeScript checks, frontend tests, lint, frontend build and the Tauri release compile pass. The main workspace passes 101 Bun tests and 28 Rust tests. This does not mean end-to-end integration with real accounts or notarisation is done.
