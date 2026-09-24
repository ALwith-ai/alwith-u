# ALwith U

支持平台：

- macOS 13 及以上，仅支持 Apple Silicon。
- Windows 10 1809 及以上，支持 x64 和 ARM64。

## 安装环境

### macOS

安装 [Homebrew]

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装 [Rust]

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

安装项目指定的 [Bun 1.4.2]

```shell
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
```

安装 [uv]

```shell
curl -LsSf https://astral.sh/uv/install.sh | sh
```

完成后重新打开终端。

### Windows

1. 安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **Desktop development with C++**。
2. 确认已安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。
3. 使用 PowerShell 执行下面的命令。

安装 [Rust]

```powershell
winget install --id Rustlang.Rustup
```

安装项目指定的 [Bun 1.4.2]

```powershell
iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.2"
```

安装 [uv]

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

完成后重新打开 PowerShell。不要在 WSL 中启动本项目。

### 安装 Fabric

用 [uv] 安装 [Python]

```shell
uv python install
```

安装 [uv] 工具

```shell
uv tool install ruff
```

```shell
uv tool install fabric --with InquirerPy --with rich
```

## 开发

拉取源码并安装依赖：

```shell
bun install
```

使用 Fabric 启动开发版：

```shell
fab tauri
```

首次编译 Rust 依赖需要一些时间。

## 构建和检查

```shell
fab build   # 构建安装包
fab check   # 执行前端和 Rust 的完整检查
fab format  # 格式化 Rust 和前端源码
```

查看全部 Fabric 命令：

```shell
fab -l
```

[Homebrew]: https://brew.sh/zh-cn/
[Rust]: https://www.rust-lang.org/
[Bun 1.4.2]: https://bun.com/
[Python]: https://www.python.org/
[uv]: https://astral.sh/uv
