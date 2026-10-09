# ALwith U

Your next product is an Agent. Launch it in 30 minutes.

Built on ALwith’s ready-made components. Powered by Codex CLI. Designed by you.

Your brand. Your experience. Your edge.

## Install from source

Install the Bun version pinned in `package.json`, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. macOS requires 26.0+ on Apple Silicon.

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
