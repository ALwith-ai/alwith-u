# ALwith U

Your next product is an Agent. Launch it in 30 minutes.

Built on ALwith’s ready-made components. Powered by Codex CLI. Designed by you.

Your brand. Your experience. Your edge.

## User guide

Read the [ALwith U Guide](guide/index.md), or click the question-mark button next to your account in the app. The English guide is bundled with the application and opens in its own window.

## Install from source

Install the Bun version pinned in `package.json`, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. macOS requires 26.6+ on Apple Silicon.

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

## Test a local generator candidate

Set `CREATE_ALWITH_PATH` to an absolute checkout path to bundle a local
`create-alwith` candidate during desktop development or script tests:

```sh
CREATE_ALWITH_PATH=/absolute/path/to/create-alwith bun run dev:tauri
CREATE_ALWITH_PATH=/absolute/path/to/create-alwith bun run test:scripts
```

Install the candidate's dependencies first. This development override does not
change U's production dependency manifest or lockfile.


### Enterprise source builds

The enterprise integration is compiled from the Git commit pinned in
`src-tauri/Cargo.toml` and `Cargo.lock`. Local builds use your Git credential
helper to read the enterprise repository. No enterprise npm package or separately
staged native library is needed.

Desktop CI builds require the `ENTERPRISE_GIT_READ_TOKEN` Actions secret, with
`read_repository` access to the pinned enterprise source project. The build
helper supplies this credential only to that Git host. Configure this secret in
repository settings; do not put it in the Cargo URL or source files.
