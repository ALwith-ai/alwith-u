# ALwith U

Your next product is an Agent. Launch it in 30 minutes.

Built on ALwith’s ready-made components. Powered by Codex CLI. Designed by you.

Your brand. Your experience. Your edge.

## Desktop runtime

On macOS the application runs on CEF: the main interface, transparent pets, nonactivating panels,
and an embedded live browser whose tabs conversations can drive through session-bound browser
tools. On Windows it runs on Wry, which has no embedded browser. See
[validation notes](docs/cef-validation.md) for the tested scope and
[docs/browser.md](docs/browser.md) for how the browser is built and checked.

The CEF runtime and its bindings come from the repositories named in `src-tauri/Cargo.toml`
(`[patch.crates-io]`), pinned by commit; both are public. The patched `tauri` crate is vendored in
`src-tauri/patches/tauri`. The matching CEF build is downloaded by the bindings when they are
built; `docs/browser.md` says how a local one is used instead. The `experimental-cef` feature selects
the experimental CEF ABI; it must only be used with its matching SDK and framework.

```sh
bun run stage
bun run build
CARGO_TARGET_DIR=/path/to/cef-target \
  bun tauri build --debug --bundles app --features hasgard-testing,experimental-cef \
  --config '{"bundle":{"macOS":{"signingIdentity":"-","hardenedRuntime":false}}}'
```

Native shell smoke tests use `ALWITH_U_CEF_SHELL_TEST=1`,
`ALWITH_U_CEF_TEST_PROFILE` (an absolute disposable directory),
`TAURI_HASGARD_DISPLAY=secondary` and a dedicated `TAURI_HASGARD_SOCKET`.
This debug-only mode explicitly refuses Runtime startup and does not validate AI
sessions. Session tests must use `startTestRuntime` as described in `AGENTS.md`.
Use `--use-mock-keychain` when launching the smoke-test bundle.

## User guide

Read the [ALwith U Guide](guide/index.md), or click the question-mark button next to your account in the app. The English guide is bundled with the application and opens in its own window.

Ask **ALwith Docs** in chat for versioned setup, model configuration and troubleshooting guidance. Its chapter citations open the same guide. Manage the skill in the existing Skills catalog.

The guide reader and documentation tools share `guide/index.md` and `guide/catalog.json`. `bun run docs:build` generates the skill's reference manual; development, production builds and sidecar staging run this step automatically. Edit the source guide, not the generated files in `src-tauri/resources/adapter/alwith-docs`. `bun scripts/verify-docs.ts` checks the Codex skill catalog in an isolated home without using a model or copying login credentials.

## Install from source

Install the Bun version pinned in `package.json`, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. macOS requires 26.0+ on Apple Silicon; iOS simulators need 26.6 (Xcode 27).

```sh
git clone https://github.com/ALwith-ai/alwith-u.git
cd alwith-u
bun install
```

## Run

```sh
bun run dev:tauri
```

Dev1 builds the mobile Rust SDK and native library together from the pinned development sources.
Keep the matching `alwith-modules` checkout next to U, or set `ALWITH_MODULES_SOURCE` to its path.
Use `bun run dev:tauri` or `bun run build:desktop --debug` for Dev1. The first build prepares a platform-specific candidate in `src-tauri/target-dev1`.

Sign in to ALwith, then configure Codex or a model provider in settings to start chatting.

## Build

```sh
bun tauri build
```

Installers are generated in `src-tauri/target/release/bundle/`.
On macOS, open the `.dmg` and drag ALwith U into Applications. On Windows, run the generated installer.

## Test

Run `bun test` for Bun-native script tests, or `bun run test` for the complete
suite, including frontend and engine tests under Vitest. Vitest supplies jsdom
and the mocks required by application tests.

## Test a local generator candidate

Set `CREATE_ALWITH_PATH` to an absolute checkout path to bundle a local
`create-alwith` candidate during desktop development or script tests:

```sh
CREATE_ALWITH_PATH=/absolute/path/to/create-alwith bun run dev:tauri
CREATE_ALWITH_PATH=/absolute/path/to/create-alwith bun run test:scripts
```

Install the candidate's dependencies first. This development override does not
change U's production dependency manifest or lockfile.


### Enterprise native module

Enterprise authentication and gateway access use `@alwith/enterprise-client`
and the independently built `@alwith/native-enterprise` platform artifacts.
`bun run stage` verifies and copies the native library and its license notices;
release builds sign the staged macOS library with the application's identity.

Install dependencies before running Cargo: the Rust transport comes from
`node_modules/@alwith/enterprise-client/rust`. Application builds require no
access to the private enterprise implementation repository.
