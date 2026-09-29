# 应用图标

当前源图为 `../app-icon.png`，来自用户提供的 `alwithU-logo-colors.png`。
保留原图颜色和透明背景，通过项目安装的 Tauri CLI 生成各平台资源。

在仓库根目录重新生成：

```sh
bun run tauri icon src-tauri/app-icon.png --output src-tauri/icons
```

`tauri.conf.json` 使用本目录的 PNG、ICNS 和 ICO 图标。`../icon.svg` 是未被引用的旧图标源，不用于当前图标生成。
