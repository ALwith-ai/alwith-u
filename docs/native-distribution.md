# U 的闭源依赖分发

U 源码可公开；Auth 等私有实现不随源码公开，也不需要私有仓权限。

| 层 | U 使用什么 | 是否需要私有源码 |
| --- | --- | --- |
| 前端 API、聊天、账号接口 | npm 的 `@alwith/api`、`@alwith/module-chat`、`@alwith/module-auth` | 否 |
| 原生 Auth 刷新、应用发现 | `@alwith/native` 自动选择平台动态库 | 否 |
| Tauri | `src-tauri/src/native.rs` 的薄 C ABI 桥接 | 否；不含 Auth 实现 |
| Agent 托管 | 固定版本 Runtime 二进制 | 否 |

`bun install` 安装依赖，`bun run stage` 校验、复制原生产物及许可，
`bun run tauri build` 使用相同 staging 链。跨架构构建先执行
`bun install --os='*' --cpu='*'`，再传目标 triple。

原生库由私有 alwith-modules 仓的 CI 生成：macOS、Windows、Linux 各有
arm64 / x64 产物。平台包只包含动态库、artifact.json 和许可声明；不含
Auth Rust 源码。`@alwith/native` 的构建脚本不在 WebView 中运行。

## 不变的行为

- Auth 与 Runtime 分开，不新增常驻进程。
- 刷新仍由共享 Rust 实现合并；同一应用的窗口共用刷新状态。
- U 和 Desktop 各自保留原有 JSON 凭据；不迁移、不共享 token 文件。
- npm 发布账号与最终用户 ALwith 登录无关。
- 桌面动态库不是移动端产物，不能声称已经支持 iOS / Android。

## 验收边界

本地 Cargo 编译通过不等于分发完成。最终检查必须在独立目录使用公开
npm 和可匿名下载的 Runtime，不能复制本机 binaries、node_modules 或私有仓。
每个平台以实际 CI 结果为准；签名、公证及真实账号联调另行验收。

## 当前发行范围（2026-09-16）

- 原生库与 Runtime 都是 npm 平台包(`@alwith/native`、`@alwith/runtime`,各自五个平台:
  macOS arm64、Linux x64/arm64、Windows x64/arm64,不出 Intel Mac),由各自仓库的 CI 经
  trusted publishing 发布,版本号与仓库 tag 一致。
- 构建时 `stageNative()` / `stageRuntime()` 校验平台包里钉的 SHA256 再拷进资源与 sidecar;
  不读取 GitHub token,不向私有仓请求文件,不隐式借用相邻仓(`RUNTIME_SOURCE=sibling`、
  `RUNTIME_PATH` 是显式的开发覆盖)。
- macOS ARM64 隔离目录验证：公开依赖安装、完整 staging、TypeScript 检查、
  前端测试、lint、前端 build 和 Tauri Release 编译通过。主工作区共 101 项
  Bun 测试、28 项 Rust 测试通过；不代表真实账号端到端联调或公证完成。
