# 应用扩展

U 使用 `@alwith/module-extension` 提供应用扩展，与 Codex Plugin / Skill 的目录、协议和状态完全独立。

## 使用

1. 点击会话导航栏“插件”下方的“扩展”，进入 -1 屏的扩展管理页面。也可以在设置中打开“应用扩展”，或在命令面板选择“管理应用扩展”。
2. 管理页直接显示已安装扩展，支持按名称、ID、版本、描述和作者搜索。选择“从本地目录安装”，选择包含新格式 `manifest.json` 和已构建 CommonJS 入口的目录。
3. 启用扩展后，命令显示在命令面板，页面可从命令面板打开，设置贡献显示在对应扩展下。
4. 列表右侧开关控制启停，更多菜单提供“从目录更新”和“卸载”。禁用保留数据；卸载默认保留安装来源与数据。同来源重装可复用数据。

管理页参照 Desktop 的标题、BETA、搜索框和扁平列表布局；宽窗口双列，窄窗口单列。当前不显示市场和已安装页签，不接入旧 Desktop 市场。列表显示名称、可选描述和网络图片图标，底部仅显示“作者 / v版本号”（无作者时仅显示版本号）；不展示扩展 ID 和运行状态，ID 仍可用于搜索。作者网址由系统浏览器打开。

插件和扩展共享 -1 屏，分别显示选中态。底部箭头返回主屏后，再次进入 -1 屏会回到上次选择的管理页面；聊天内容在屏幕切换时保持挂载。扩展入口不依赖 Codex 插件服务是否可用。

仅安装可信扩展。扩展在宿主同一 JavaScript 上下文中执行，此实现不提供恶意代码沙箱。旧 Desktop 格式的扩展需要用新 SDK 重新构建。

## 简化清单（SDK 0.1.0）

```json
{
  "id": "alwith-static-wallpaper",
  "name": "静态壁纸",
  "version": "1.0.0",
  "description": "为工作空间设置静态背景图片",
  "author": "ALwith",
  "authorUrl": "https://alwith.ai",
  "dependencies": { "@alwith/module-extension": "^0.1.0" },
  "hosts": { "alwith-u": ">=0.1.1" }
}
```

四个展示字段均可省略，不影响激活和能力授权；填写时必须是非空字符串，不接受 `null`。

| 字段 | 含义 |
| --- | --- |
| `description` | 扩展简介，支持列表搜索 |
| `author` | 作者名称，支持列表搜索 |
| `authorUrl` | 作者主页的 HTTP/HTTPS 绝对网址，不接受内嵌用户名或密码 |
| `icon` | HTTP(S) 图片网址或 `lucide:clock` 等本地图标标识，无需启用扩展或申请 HTTP 能力 |

SDK 0.1.0 支持 `lucide:blocks`、`lucide:play`、`lucide:panel`、`lucide:settings`、`lucide:clock`、`lucide:chart`、`lucide:globe`，名称必须完全匹配小写。公共包 `parseManifestIcon(icon)` 返回 image/url 或 lucide/name 描述，不依赖 React、DOM 或 Lucide；宿主负责映射到本地组件。U 与扩展入口共用图标映射，本地图标离线和禁用时均可显示。未知标识在构建/安装时明确报错。

图标未填或远程图片加载失败时显示默认图标。图片请求不发送来源页地址；网络可用性与宿主 WebView 的安全策略仍会影响加载。图标不接受包内相对路径、`file:` 或 `data:` URL，作者主页仍只接受 HTTP(S)。静态壁纸使用 HTTPS 画框图片（1.0.0），时间漫游使用 `lucide:clock`（1.0.0）。描述、作者按纯文本展示，不执行 HTML。

- `dependencies` 只接受 SDK 兼容版本范围，不执行 npm 安装。公共包、SDK API 和随包 Rust crate 均为 0.1.0。
- `hosts` 可省略；非空时只允许匹配的宿主 ID 与版本，多条记录为可选宿主集合。U 提供自己的 ID `alwith-u` 和真实应用版本，应用版本与 SDK 版本独立。
- 默认 `manifestVersion: 3`、`entry: "main.js"`、`dataSchemaVersion: 1`，作者无需重复填写。显式入口仍需是合法的包内相对路径。
- 清单不接受 `engines`、`capabilities`、`contributions`、`externals`；不保留 v2 兼容分支。构建器不会生成这些字段。
- SDK/宿主版本在执行扩展代码前检查；模块缺失在 require 时、能力缺失在请求时、入口不支持在注册时明确报错。宿主模块映射与能力授权仍然生效。
- `context.supportsCapability(key)` 和 `context.supportsContribution(kind)` 用于可选功能检测。激活失败会释放受管理资源；已经发送的外部副作用不能撤销。
- 数据版本仍由服务校验；改变 schema 需要迁移，当前服务拒绝该类升级。它不校验 JSON 业务结构，扩展需自行处理。

开发版本已重置：公共包、SDK API 与 Rust crate 为 0.1.0，两个内置扩展和本公共包示例均为 1.0.0，功能保持不变。宿主 U 仍为 0.1.1，清单版本仍为 v3、协议版本仍为 1。旧开发产物需按 SDK ^0.1.0 重新构建，不绕过版本检查。本机 U 扩展数据已按用户要求清空，不保留临时备份。

当前已构建：公共原生能力示例 `../alwith-modules/packages/extension/examples/dist/native-0.1.0/`，八个 UI 入口示例 `../alwith-modules/packages/extension/examples/dist/ui-entrypoints-0.1.0/`，计数器 `../alwith-modules/packages/extension/examples/dist/portable-0.1.0/`。选择其中包含 manifest.json/main.js 的扩展目录安装。

## 清单多语言（SDK 0.1.0）

采用 `manifest.locales`，标题和介绍的翻译集中在清单内：

```json
{
  "id": "alwith-static-wallpaper",
  "name": "Static wallpaper",
  "description": "Static backgrounds for your workspace",
  "version": "1.0.0",
  "dependencies": { "@alwith/module-extension": "^0.1.0" },
  "hosts": { "alwith-u": ">=0.1.1" },
  "locales": {
    "zh": { "name": "静态壁纸", "description": "为工作空间设置静态背景图片" },
    "zh-CN": { "name": "静态壁纸" }
  }
}
```

公共包的 `resolveManifestText(manifest, language)` 按完整语言码、基础语言码、顶层默认值逐字段回退，忽略语言码大小写，不修改原清单。例如 zh-CN 使用区域标题和 zh 的介绍。未提供介绍时不显示；也可以仅为某种语言提供介绍。

公共包负责构建/安装校验、持久化与纯函数解析；宿主只提供当前语言并订阅语言变化。解析器不依赖 i18next、React、DOM 或 Tauri，其他宿主可使用任意国际化框架。翻译随 `Installation.manifest.locales` 保存，禁用扩展不需要执行代码即可展示。

U 切换语言后立即刷新列表、搜索、开关标签及卸载提示，不启停扩展。原生通知/弹窗适配器通过 `{ language: () => i18n.language }` 每次操作读取当前语言；其他宿主省略回调时使用默认文案。扩展页面内部文案继续由扩展自身处理。

语言键使用 2–8 个 ASCII 字母，可接连字符分隔的 1–8 位字母数字子标签，如 `en`、`zh-CN`、`zh-Hant-TW`、`es-419`。大小写重复的语言键报错；每个语言对象至少包含一个非空白字符串 `name` 或 `description`，不允许其他字段、null、数组或空对象。整个 `locales` 可省略或为 `{}`。无须额外文件、占位符或默认语言配置。

SDK 0.1.0 只支持 locales 解析，不保留 NLS 双路径。`manifest.nls.*.json` 仅作为普通资源，`%key%` 原样显示。旧 NLS 扩展应重建为 locales 清单，旧开发包统一重建并声明 SDK ^0.1.0。

## 包与宿主边界

引擎源码在 `alwith-modules/packages/extension`。U 的 `src/features/extensions` 只装配宿主模块映射、能力和 UI 出口，不维护第二份引擎。

当前使用固定本地产物 `vendor/alwith-module-extension-0.1.0-99c62bfd.tgz`，校验值记录在 `bun.lock`；尚未发布 npm 版本。应用构建不读取 sibling 源码。Rust 从 `node_modules/@alwith/module-extension/rust` 编译，扩展本身不编译 Rust。保留包内 LICENSE 与第三方声明，不改变 U 自身的许可证。

主窗口和设置窗口各有一个窗口 Host，共用进程内原生服务。原生服务负责安装选择、启用意图、CAS 数据、资源访问和多窗口停止屏障。数据位于对应应用 identifier 的本地数据目录下 `extensions/`，不写入 Codex 会话目录。

每个扩展的代码包与配置放在同一个扩展目录，内部保持读写隔离：

```text
extensions/
├─ state.json
├─ <extensionId>/
│  ├─ packages/<packageRevision>/  # manifest、代码和随包资源
│  └─ data/
│     ├─ data.json                # 当前配置及身份、schema、revision
│     └─ .previous.json           # 最多一份写入恢复备份
└─ .legacy-v1/                    # 从旧布局迁移时保留的原始目录
```

新版原生服务首次打开旧布局时自动迁移，保留来源身份、配置、启用状态和卸载保留记录；迁移中断后可继续。旧版原生服务不能读取新布局，不能直接降级。公共 SDK 的 `context.data` 和资源接口不变，扩展无需自行拼接磁盘路径。代码包仍为不可变内容，配置通过原生服务写入；不把用户配置打进分发包，也不允许包资源接口读取 `data/`。壁纸导入库属于宿主，继续存放在 `wallpapers/`。


U 提供 `commands`、`settings`、`surfaces`、`topBar`、`navigation`、`statusBar`、`settingsPages`，贡献版本均为 `1.0.0`；扩展 SDK/API 均为 `0.1.0`。公共原生能力见下节；工作区、编辑器、统计等业务能力未绑定，扩展请求这些能力时会明确报错。扩展存储初始化失败由扩展功能报告，不阻断 U 主应用启动，不静默清空损坏数据。

### 入口与页面分开

顶部和导航按钮是动作入口，`surfaces` 是可挂载的内容页面。多个动作可以打开同一页面，也可以只执行命令。扩展管理页属于宿主功能，不是扩展自己注册的页面。

| 内容 | 独立包负责 | U 负责 |
| --- | --- | --- |
| 动作和命令 | 注册、扩展归属、撤销 | 按钮位置、命令面板、执行与页面路由 |
| 页面和设置 | 视图登记、挂载、取消与资源释放 | 容器、选中状态、尺寸、关闭和错误展示 |
| 状态栏 | 可挂载的紧凑视图 | 左／中／右分区及溢出处理 |
| 原生能力 | 可复用合同与适配器、包内 Rust 基础设施 | 编译、授权、访问策略及业务服务装配 |

页面内的定时器、订阅和 React root 应在挂载时创建，并随挂载清理。隐藏页面不等于卸载，不能依赖 CSS 隐藏停止后台任务。宿主适配必须经引擎挂载视图，不能直接调用贡献的 `mount()` 绕过资源管理。

Desktop 旧系统另有导航板、工作台标签页、文件编辑器、-1 屏目录及自定义模态弹窗。这些不因新包提供 `surfaces` 就自动兼容；工作台和编辑器合同尚未接入新体系，U 不提供这些产品功能。现有 `dialogs` 只提供消息／确认对话框，不承载自定义扩展页面。

完整旧入口盘点、迁移映射和后续接入条件见[核心设计第 21 节](../.docs/extension/core-design.md)。Desktop 源码保持不变，新格式扩展不能直接安装到旧 Desktop 扩展系统。

## 开发与验证

共享包提供 `/build` 的 Bun 构建 API，以及 `examples/portable` 命令、设置、React 页面和持久计数样本。`examples/host` 是独立双窗口 Tauri 宿主，JavaScript 与 Rust 均消费打包产物。构建与运行步骤见该包 README。

本次已验证共享包测试、U 全部 CI 检查、Rust 检查，以及 macOS 打包样例的安装、启用、双窗口数据同步、禁用和重启保留数据。干净纯内核消费者无需 DOM、React 或 Tauri 即可导入和通过类型检查。

当前仍为初始版本：不提供 ZIP/网络市场安装、schema 迁移与回滚、清除数据和旧包回收；schema 变化明确拒绝。未完成 Windows/Linux WebView 和掉电一致性验收，也未替换 Desktop。新旧市场产物继续隔离。

## 公共原生能力

U 显式注册以下能力，扩展通过 SDK 的 capability key 获取，无需在 manifest 声明；缺失或未授权时明确报错，可先用 `context.supportsCapability(key)` 查询是否存在提供器（查询不代表已授权）：

| ID | SDK key | U 的范围 |
| --- | --- | --- |
| `http` | `httpCapability` | 仅 `https://api.alwith.ai/service/**` 与 `https://api-dev.alwith.ai/service/**`；不注入宿主登录凭据 |
| `notifications` | `notificationsCapability` | 查询权限、显式申请权限、发送通知；标题带扩展名 |
| `externalLinks` | `externalLinksCapability` | 打开 HTTP(S) 外链；拒绝 URL 内嵌用户名/密码，不接受本地路径与指定程序 |
| `dialogs` | `dialogsCapability` | 消息与确认对话框，标题为扩展名；不包含文件选择 |

合同属于独立扩展包的纯 SDK；可选 Tauri 实现在 `/tauri/capabilities`。U 复用已有 HTTP、通知、opener、dialog 原生插件，为主窗口和设置窗口增加 `dialog:allow-message`，并禁用 HTTP 插件的共享 Cookie 容器，保留 TLS、HTTP/2、字符集和系统代理支持。U 登录继续使用已有的显式 Bearer Token。Rust 基础设施继续随包交付并由宿主编译，本轮没有给扩展增加 Rust，也没有迁移 U 的 Codex 插件体系。

HTTP 首期提供文本/JSON 请求与 UTF-8 文本响应，默认 30 秒超时、8 MiB 响应上限；禁止自动重定向，每次新 URL 都重新检查宿主策略。原生 Tauri ACL 同时生效。请求可传视图 `Cancellation`；关闭视图、停用实例或超时会触发取消。网络取消依赖上游插件，它未暴露可独立等待的原生取消确认，不能据此声称原生网络资源已严格停止。

能力按每次激活创建并缓存，停用后保留的方法引用也会拒绝调用。通知 IPC 与原生命令返回的错误可被等待和捕获；发送成功只表示原生命令接受请求，不保证操作系统已投递或展示。当前桌面通知插件会直接报告 granted，并可能忽略后台投递错误，因此其权限值不是独立验证的 OS 授权状态。插件报告无权限时发送直接失败，不隐式弹出权限申请。原生对话框无法强制关闭，停用后拒绝迟到结果，但停止屏障要等对话框真正关闭。已提交的通知和浏览器打开操作无法撤销。

这些约束用于可信扩展的生命周期管理，不构成恶意代码隔离；同一 WebView 的 Tauri 权限仍由窗口共享。文件、进程、凭据、账号及业务原生服务继续由宿主按需提供，不属于当前公共能力范围。

## 原生能力示例扩展

四类能力各有一个独立示例，源码及操作说明见[扩展示例总览](../../alwith-modules/packages/extension/examples/README.md)：

| 示例目录 | 页面名称 | 内容 |
| --- | --- | --- |
| `examples/http` | HTTP 请求示例 | GET、状态码、响应头、文本、错误和关闭页面取消 |
| `examples/notifications` | 系统通知示例 | 查询权限、申请权限、发送通知 |
| `examples/external-links` | 外部链接示例 | 输入网址并交给系统浏览器打开 |
| `examples/dialogs` | 原生对话框示例 | 消息框、确认和取消分支 |

在 `alwith-modules/packages/extension` 中执行 `bun run build:examples <新的输出目录>`，然后从 U 逐个安装输出目录内的四个子目录，启用后通过命令面板打开同名页面。示例只在用户点击后调用能力，不自动产生系统副作用。HTTP 仍遵守 U 的域名白名单，需要自行填写已知的只读接口，不会携带宿主登录凭据。

## UI 入口示例扩展

在模块包目录执行 `bun run build:entry-examples <新的输出目录>`，可构建另一组独立示例：

| 子目录 | 安装后的触发位置 | 演示内容 |
| --- | --- | --- |
| `management` | 设置 → 应用扩展 → 管理入口示例卡片 | 宿主的安装、启停、更新、卸载与实例日志；不注册页面 |
| `commands` | 主窗口 ⌘K / Ctrl+K → 入口示例：执行命令 | 执行命令并通过消息框反馈；需要宿主 dialogs 能力 |
| `settings` | 设置 → 应用扩展 → 设置入口示例卡片下方 | 内嵌文本设置、持久保存和并发修改冲突处理 |
| `surfaces` | 主窗口 ⌘K / Ctrl+K → 入口示例：打开页面 | 内容区页面、临时计数器和关闭后重新挂载 |

分别安装对应子目录并启用即可。管理页是宿主入口，不是扩展 contribution；另外三个示例各自只注册一种 contribution。安装后看不到独立页面不一定是故障：管理示例和设置示例应在管理页操作，只有 surfaces 示例提供独立内容页。具体步骤和更新验收方法见[示例总览](../../alwith-modules/packages/extension/examples/README.md)。

## 顶部栏、导航栏、底部栏与设置栏目

独立包 0.1.1 新增以下四类正式贡献，保留原来的命令、页面及内嵌设置。新清单只声明 SDK 依赖 ^0.1.0；入口由代码直接注册，不再配置贡献清单。

| contribution | 注册方法 | U 的显示位置 | 示例子目录 |
| --- | --- | --- | --- |
| `topBar` | `context.action("topBar", action)` | 主窗口顶部左/中/右图标按钮（默认右侧） | `top-bar` |
| `navigation` | `context.action("navigation", action)` | 左侧固定“扩展”入口下方的独立导航项 | `navigation` |
| `statusBar` | `context.view("statusBar", view)` | 主窗口底部，版本信息左侧的常驻组件 | `status-bar` |
| `settingsPages` | `context.view("settingsPages", view)` | 设置窗口侧栏的独立栏目，选中后显示完整设置页 | `settings-page` |

顶部和导航动作只指向本扩展注册的命令或 `surfaces` 页面，目标 ID 使用未加扩展前缀的局部 ID。目标不存在时禁用按钮，执行失败由宿主提示。它们不会在设置窗口或独立聊天窗口重复显示；底部组件也只在主窗口挂载。打开页面仍沿用单页面与返回聊天交互。

```typescript
context.action("topBar", {
  id: "open-dashboard",
  title: "打开仪表盘",
  icon: "chart",
  order: 10,
  target: { type: "surface", id: "dashboard" }
})
```

上述动作需要本扩展另行注册 `dashboard` 页面（注册顺序不限），无需在 manifest 声明 `topBar` 或 `surfaces`。执行命令时使用 `target: { type: "command", id: "refresh" }`，并注册 `commands`。

动作及视图均支持可选 `order`（默认 0，同序按完整 ID 排列）；图标使用宿主语义图标名 `blocks`、`play`、`panel`、`settings`、`clock`、`chart`、`globe`。`mountReact` 透传图标和排序信息。导航名称过长截断；顶部、底部超宽时横向滚动，导航项过多时局部纵向滚动。底部组件限制可视高度 28px、宽度 256px，扩展应提供紧凑 UI，并在视图释放时清理定时器和订阅。

禁用、卸载或激活失败时，宿主撤销所有动作和视图，等待已有挂载资源释放。正在查看的页面或设置栏目撤销后显示“扩展页面不可用”，不会继续保留可操作的旧内容。没有贡献时不显示空工具栏或状态栏。

`bun run build:entry-examples <新的输出目录>` 现在输出八个 UI 入口示例，新增四个目录可逐个从本地安装：顶部图标打开计数页、导航项打开计数页、底部时钟及计数按钮、设置独立栏目中的持久化选项。此轮未增加托盘、独立扩展窗口或自定义快捷键注册。


本机已构建的八个入口示例在 `../alwith-modules/packages/extension/examples/dist/ui-entrypoints-0.1.0/`。新增四个为 `top-bar`、`navigation`、`status-bar`、`settings-page`。安装时选择具体子目录，目录中须同时存在 `manifest.json` 和 `main.js`；不要选择只有 `main.tsx` 的源码目录。当前安装器接受目录，不接受 ZIP/tgz。该构建产物目录不进入 Git，新检出仓库需按上面的命令构建。


## 顶部栏与底部栏的位置（0.1.0）

动作和视图通过可选 `alignment: "left" | "center" | "right"` 选择左、中、右分区。顶部默认 `right`，底部默认 `left`；现有扩展不需要改动。字段仅用于 `topBar`、`statusBar`，其他出口忽略它。新扩展使用 SDK 依赖 `@alwith/module-extension: ^0.1.0`。

```typescript
context.action("topBar", {
  id: "open-dashboard",
  title: "打开仪表盘",
  alignment: "center",
  order: 10,
  target: { type: "surface", id: "dashboard" }
})

context.view("statusBar", mountReact({
  id: "status",
  title: "运行状态",
  alignment: "right",
  order: 10,
  render: () => "就绪"
}))
```

`order` 在各分区内从左到右升序排列，同序按完整 ID 排列。三个分区等宽，中间组相对可用栏区域居中，不受两侧内容长度影响；可用区域会避开窗口控制、侧栏和版本信息。某组过长时在组内横向滚动。顶部空白区域保留原生窗口拖动功能。

最新可安装示例目录为 `../alwith-modules/packages/extension/examples/dist/ui-entrypoints-0.1.0/`。其中 `top-bar` 为 1.0.0，`status-bar` 为 1.0.0，分别同时展示左、中、右三组。已安装旧示例时，在更多菜单选择“从目录更新”并选择新目录；旧构建目录保留。


## 可选入口、注销清理与页面错误（0.1.0）

- 扩展通过 `context.supportsContribution(kind)` 查询宿主是否支持某类入口，不需要清单声明。实例已撤销时报错；不支持时返回 false，可不登记该入口而继续其他功能。
- 注销 `context.view()` 的返回句柄会立即撤销视图及全部挂载；等待返回值可等待异步资源清理。无需停用整个扩展，其他视图不受影响。
- React 页面渲染失败携带扩展 ID 和视图 ID，由 U 显示局部错误和“重试”按钮。重试重新挂载页面；任意异步任务及事件回调仍需扩展自行处理错误。
- U 的动作目标解析和排序使用公共包 `resolveActionTarget()`、`sortContributions()`；栏位、尺寸和页面路由继续归 U。

顶部栏示例版本已更新为 1.0.0，要求 SDK ^0.1.0，在代码中检测 `topBar` 是否可用。新版八个入口示例均已打包到 `../alwith-modules/packages/extension/examples/dist/ui-entrypoints-0.1.0/`；选择具体子目录安装或从目录更新。所有当前示例均要求 SDK ^0.1.0。


## 宿主能力与随包扩展发现

宿主业务实现和扩展接入分开：

| 目录 | 职责 |
| --- | --- |
| `src/features/appearance/wallpaper/` | 背景组件、展示状态和图库客户端；不依赖扩展 SDK |
| `src-tauri/src/appearance/wallpaper/` | 图片选择、校验、保存与本地资源协议 |
| `src/features/extensions/capabilities/` | 宿主能力合同、生命周期适配器与提供器注册 |
| `src/features/extensions/policy.ts` | 根据原生安装来源检查私有能力授权及管理操作策略 |
| `src/features/extensions/bundled.ts` | 通用的首次安装和版本升级协调 |
| `src-tauri/src/bundled_extensions/` | 扫描随包资源目录、核对身份、授予限定路径的安装权限 |

随包扩展直接从应用资源目录的 `extensions/` 子目录发现，不再维护 `host.json`。开发环境读取 `src-tauri/resources/extensions/`，发布环境读取 Tauri 的实际应用资源目录。新增随包扩展只需将构建产物复制到 `src-tauri/resources/extensions/<id>/`，目录名必须与 manifest ID 一致。

扫描只处理直接子目录，按目录名排序，忽略 `.DS_Store` 等普通文件。资源根目录不可读、扩展目录名非法、manifest 缺失或损坏、ID 重复或与目录名不一致、目录项或 manifest 为符号链接时明确报错，不静默忽略错误的分发产物。扩展包完整校验继续由公共安装器负责。

所有随包扩展使用统一规则：

- 原生宿主固定赋予来源 `bundled:alwith-u`；扩展 manifest 不能自行取得该身份。
- 首次自动安装并启用；同版本不覆盖，高版本不降级，更高随包版本通过公共更新状态机安装，保留已有启停状态与数据。
- 管理页允许启停，不提供手动目录更新和卸载入口。本地安装扩展继续提供这两个操作。
- 同名但来源不同的已有扩展不会被覆盖，安装协调明确报错。
- 从分发目录移除扩展不会自动卸载已有安装或删除用户数据。

私有能力在 `src/features/extensions/capabilities/` 注册，当前提供 `alwith.u.wallpaper`。提供器创建时校验原生安装记录的 ID 和来源，只允许 `bundled:alwith-u` 使用；不再逐扩展维护授权列表。manifest 不再声明能力需求；实际取得能力时执行来源授权。当前授权范围覆盖所有随包扩展，普通本地安装的同名扩展不会获得该权限；公共 SDK 能力继续按各自策略提供。未来新增敏感能力时应在提供器注册处明确访问策略。

背景展示控制器采用最后一次提交生效的规则，旧实例释放不会清除新实例背景。来源策略服务于可信扩展管理，不构成同一 WebView 中的恶意代码沙箱。

`src/features/extensions/ui.ts` 通过运行时模块名 `@alwith/u-extension-ui` 向扩展提供宿主 UI 组件。根目录无需保留 `extensions/`，扩展源码、分发产物和运行时用户数据仍各自独立。

## 内置静态壁纸

U 自带 `alwith-static-wallpaper` 扩展，首次启动自动安装并启用，默认使用 JPG 雾山壁纸。管理页不显示“内置”标签，可禁用；参数入口是 **设置 → 壁纸**，支持 8 张内置 JPG、本地导入、填充/适应、亮度、模糊、应用/取消和恢复默认。主窗口主屏与 -1 屏共享背景，独立聊天窗口不接入。

源码位于 `../alwith-extensions/alwith-static-wallpaper/`。在扩展目录执行 `bun run build`，然后手动将 `dist/extension/` 的全部内容复制到 U 的 `src-tauri/resources/extensions/alwith-static-wallpaper/`，与 U 一起提交和分发。壁纸不生成 npm 包，U 不安装壁纸依赖，`dev` / `build` 不自动构建或复制扩展。U 在 `src/features/extensions/capabilities/wallpaper-contract.ts` 定义宿主能力合同，不从扩展产物导入合同。扩展产物不含 `contracts/`；只读默认配置放在包内 `data.json`，通过资源接口加载，有用户配置时以用户配置为准。升级扩展须增加 manifest 版本；同版本不会覆盖现有安装或用户禁用状态。

```sh
# 在 alwith-extensions/alwith-static-wallpaper 目录执行
bun run build
mkdir -p ../../alwith-u/src-tauri/resources/extensions/alwith-static-wallpaper
cp -R dist/extension/. ../../alwith-u/src-tauri/resources/extensions/alwith-static-wallpaper/
```

公共包提供生命周期、配置 CAS 和包资源地址；壁纸展示及图片导入由 U 的版本化能力 `alwith.u.wallpaper` 提供，Rust 保留在宿主。导入图片保存到应用本地数据目录，配置保存在扩展自有数据中，不改写原图或扩展包。详见[使用与开发说明](../../alwith-extensions/alwith-static-wallpaper/README.md)。

当前公共包、SDK API 和 Rust crate 的版本基线为 0.1.0，后续只递增末位版本号（下一版 0.1.1）。两个内置扩展和公共包示例均从 1.0.0 开始。原有的 locales、Lucide 图标、原生能力、扩展入口和数据隔离功能全部保留；U 应用自身版本仍为 0.1.1。

## 内置时间漫游

`alwith-time-roamer` 1.0.0 使用 SDK ^0.1.0，在主窗口状态栏右侧显示本地时间与随时段变化的图标、短句，例如 `☀️ 14:32 · 午后漫游`。宽度随内容变化，受宿主最大宽度限制，整体右对齐；悬停使用半透明主题底色，跟随 U 界面语言实时切换中英文，其他语言显示英文。点击切换为今日进度，悬停查看完整日期、星期与系统时区；支持键盘聚焦及 Enter / 空格切换。按钮采用块级弹性布局，避免文字基线撑高；宿主状态栏分组与组件容器禁止纵向滚动，保留横向溢出处理。

名称与简介采用 `manifest.locales`：顶层为英文 `Time Roamer`，`locales.zh` 提供中文“时间漫游”。管理页通过公共解析器随语言切换更新显示和搜索，禁用扩展仍可解析翻译；未翻译语言回退英文，不再中英并列，也不生成 NLS 文件。

扩展按分钟刷新，窗口恢复焦点或可见性变化时立即读取系统时间。跨日自动归零，进度按当地两个午夜之间的实际时长计算，兼容夏令时。显示模式属于当前挂载，不写入用户配置；定时器、监听和样式随视图卸载或禁用释放。首次自动安装并启用，可在扩展管理页关闭。

源码与构建说明位于 [`../alwith-extensions/alwith-time-roamer/`](../../alwith-extensions/alwith-time-roamer/README.md)，U 仅保存 `src-tauri/resources/extensions/alwith-time-roamer/` 分发产物。无需新增宿主能力、Rust 代码或扩展注册列表；构建后手动复制产物，更新时递增扩展版本。
