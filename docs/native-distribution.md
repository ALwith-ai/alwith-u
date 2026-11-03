# Distribution of U's closed-source dependencies

U's source can be public. Private implementations such as Auth are not published with it, and building U needs no access to private repositories.

| Layer | What U uses | Needs private source |
| --- | --- | --- |
| Frontend API, chat, account interface | `@alwith/api`, `@alwith/module-chat`, `@alwith/module-auth` from npm | No |
| Native module libraries (Auth, Drive, FS, Computer, Device, Voice and the others) | Each `@alwith/module-<module>` package ships its private library under `native/<platform>/` | No |
| Tauri | The public `alwith-<module>` crates from crates.io, registered in `src-tauri/src/lib.rs` | No; they hold no module implementation |
| Agent hosting | A pinned Runtime binary | No |

`bun install` installs the dependencies, `bun run stage` verifies and copies the native artifacts and their licences (`stageNativeModule` from `@alwith/module-desktop-shell/stage`), and `bun tauri build` uses the same staging chain. For a cross-architecture build run `bun install --os='*' --cpu='*'` first, then pass the target triple.

The native libraries are produced by the CI of the private alwith-modules repository, with macOS ARM64, Windows x64 and Linux x64 artifacts. A module package's `native/<platform>/` directory contains only the dynamic library (and, for Device, its helper), `artifact.json` and licence notices; no module Rust implementation. Staging never runs in the WebView.

Vibemon, bubble, and chat windows are managed by U's Tauri host. On macOS they share the local `tauri-nspanel` integration, including focus, input-method support, and window lifecycle. Vibemon state, animation, and assets remain in the shared frontend packages.

Vibemon request deduplication also lives in U's Rust host. Claims remain in memory for the process lifetime, after the host validates the calling window and the Runtime's session owner and execution state. U does not call vibemon methods in the native library.

## Unchanged behaviour

- Auth stays separate from the Runtime; no new resident process.
- Refresh is still coalesced by the shared Rust implementation; windows of one app share refresh state.
- U and Desktop each keep their own JSON credentials; token files are neither migrated nor shared.
- The npm publishing account has nothing to do with end users' ALwith login.
- The desktop dynamic libraries are not mobile artifacts; iOS and Android support cannot be claimed.

## Acceptance boundary

A passing local Cargo build does not mean distribution is done. The final check must run in a separate directory using public npm and an anonymously downloadable Runtime, without copying local binaries, `node_modules` or private repositories. Each platform is judged by its actual CI result; signing, notarisation and integration with real accounts are accepted separately.

## Current release scope (2026-09-16)

- The native libraries ship inside the `@alwith/module-<module>` packages and the Runtime in `@alwith/runtime` platform packages (macOS ARM64, Linux x64 and Windows x64), published by each repository's CI through trusted publishing with versions matching the repository tag.
- At build time `stageNativeModule()` / `stageRuntime()` verify the module identity, contract, ABI and the SHA256 pinned in the package before copying into resources and sidecars. No GitHub token is read, no file is requested from a private repository, and no neighbouring checkout is borrowed implicitly (`RUNTIME_SOURCE=sibling` and `RUNTIME_PATH` are explicit development overrides).
- Verified in an isolated macOS ARM64 directory: public dependency install, full staging, TypeScript checks, frontend tests, lint, frontend build and the Tauri release compile pass. The main workspace passes 101 Bun tests and 28 Rust tests. This does not mean end-to-end integration with real accounts or notarisation is done.
