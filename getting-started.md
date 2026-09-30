# ALwith U

Supported platforms:

- macOS 13 or later, Apple Silicon only.
- Windows 10 1809 or later, x64 and ARM64.

## Set up the environment

### macOS

Install [Homebrew]

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install [Rust]

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Install the project's pinned [Bun 1.4.2]

```shell
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
```

Install [uv]

```shell
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new terminal afterwards.

### Windows

1. Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++** selected.
2. Make sure the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) is installed.
3. Run the commands below in PowerShell.

Install [Rust]

```powershell
winget install --id Rustlang.Rustup
```

Install the project's pinned [Bun 1.4.2]

```powershell
iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.2"
```

Install [uv]

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Open a new PowerShell afterwards. Do not start this project from WSL.

### Install Fabric

Install [Python] with [uv]

```shell
uv python install
```

Install the [uv] tools

```shell
uv tool install ruff
```

```shell
uv tool install fabric --with InquirerPy --with rich
```

## Develop

Clone the source and install dependencies:

```shell
bun install
```

Start the development build with Fabric:

```shell
fab tauri
```

The first build of the Rust dependencies takes a while.

## Build and check

```shell
fab build   # build the installer
fab check   # run the full frontend and Rust checks
fab format  # format Rust and frontend sources
```

List every Fabric command:

```shell
fab -l
```

[Homebrew]: https://brew.sh/
[Rust]: https://www.rust-lang.org/
[Bun 1.4.2]: https://bun.com/
[Python]: https://www.python.org/
[uv]: https://astral.sh/uv
