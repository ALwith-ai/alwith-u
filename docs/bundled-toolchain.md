# Bun 与 Codex 随包发布

## 目录边界

Bun、Codex、codex-code-mode-host、编译版 codex-acp-v2 和 ALwith Runtime
通过 Tauri `bundle.externalBin` 随 U 安装、升级和回退。应用内部使用包内绝对路径；
不读取或写入 Desktop 的 `~/.alwith/`，也不向该目录复制程序。
U 的偏好与缓存使用 Tauri 应用专属目录；Codex 仍管理自己的 `~/.codex`。

DSH 开发入口默认使用包内 Bun。显式设置 `ALWITH_U_BUN` 时必须传绝对文件路径；
它不会自动搜索系统 PATH。包内 Bun 不安装成系统命令。

## 版本来源

| 程序 | 权威版本 | 对应产物 |
| --- | --- | --- |
| Bun | `package.json#packageManager` 的 `bun@X.Y.Z` | 五个 `@oven/bun-*` optionalDependencies 必须同版本 |
| Codex | `devDependencies.@openai/codex` | 五个 `@openai/codex-*` npm alias 必须同版本 |
| ACP 适配器 | `devDependencies.@nyssance/codex-acp-v2` | 当前保留独立编译程序，内含 Bun 运行时 |

构建 Bun 必须等于 `packageManager`，CI 通过 `bun-version-file: package.json` 安装。
`scripts/check-toolchain.ts` 检查所有平台声明；`scripts/stage.ts` 还检查已安装平台包，
并在原生目标上运行暂存 Bun 与 Codex 的 `--version`。

## 升级步骤

1. Bun：更新 `packageManager` 和全部 `@oven/bun-*` 精确版本。
   Codex：更新主包版本和全部 `npm:@openai/codex@X.Y.Z-<platform>` alias。
   先确认目标版本已发布所有需要的平台产物。
2. 使用声明版本的 Bun 执行 `bun install`，更新 `bun.lock`。
   Bun 升级时同时从对应官方 tag 更新 `src-tauri/resources/licenses/bun-X.Y.Z.md`；
   staging 会拒绝缺少对应版本许可证的构建。
3. 执行 `bun scripts/check-toolchain.ts` 和 `bun run stage`。
4. 运行项目 CI 检查、Rust 检查；Codex/适配器升级还需 `bun run test:live`。
5. 在各平台构建并安装验证，提升应用版本后按正常发布流程分发。

不使用 `latest` 或版本范围。`bun.lock` 固定官方 npm 归档与 SHA-512 integrity，
CI 使用 `bun install --frozen-lockfile`，不跳过完整性校验。
版本声明不一致、平台包缺失、二进制启动失败都中止 staging。
本仓不复制 Desktop 的下载器，也不依赖其源码或缓存。

## 构建与签名

`beforeBuildCommand` 执行 `bun run stage && bun run build`。
Bun 从官方 `@oven` 平台包的 `bin/bun[.exe]` 复制为
`src-tauri/binaries/bun-<Rust target triple>[.exe]`。
x64 使用 baseline 产物，避免额外要求用户 CPU 支持 AVX2。
Codex 与 codex-code-mode-host 保持同目录。

macOS 发布构建使用应用签名身份及 JIT entitlement 签名 Bun，再由 Tauri 完成应用签名与公证。
无发布证书的本地构建重签为 ad-hoc；两种路径均验证暂存 Bun 的签名。
Bun 上游 `LICENSE.md`（含第三方库声明与来源链接）随资源一起分发。

当前 release 矩阵为 macOS ARM64、Windows x64/ARM64；staging 另支持 Linux x64/ARM64。
跨平台 staging 不会尝试在宿主运行异构二进制，实际启动检查必须在目标 runner 完成。

## 安装包验收

构建后在目标平台执行以下脚本，传入安装产物的可执行文件目录。
它清空子进程 PATH，使用临时 CODEX_HOME，验证 Bun/Codex 版本、Bun JS 执行和适配器启动。
release workflow 自动检查 macOS `.app` 和 Windows 构建目录；Windows 安装器仍需安装验证。

```sh
bun scripts/verify-bundled-toolchain.ts "src-tauri/target/release/bundle/macos/ALwith U.app/Contents/MacOS"
```

- 在不含系统 Bun、Node.js、Codex 的环境中，包内 Bun 与 Codex 能启动且版本正确。
- ACP 初始化、会话恢复、工具调用正常；应用路径包含空格或中文时仍正常。
- 检查 macOS 每个可执行文件的签名、公证及 Bun JIT 执行。
- Desktop 与 U 同时安装互不覆盖；U 升级后使用新包内程序。
- 当前编译版适配器仍包含一份 Bun 运行时，后续可单独改成由包内 Bun 运行 JS 以减少体积。
