# ALwith U

Your next product is an Agent. Launch it in 30 minutes.

Built on ALwith’s ready-made components. Powered by Codex CLI. Designed by you.

Your brand. Your experience. Your edge.

## User guide

Read the [ALwith U Guide](guide/index.md), or click the question-mark button next to your account in the app. The English guide is bundled with the application and opens in its own window.

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
