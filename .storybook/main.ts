import path from "node:path"

import { shadcn } from "@nyssance/shadcn/vite"
import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"

const boundaries = {
  "lib/client": "client.ts",
  "features/appearance/wallpaper/controller": "wallpaper.ts",
  "lib/chat-window": "chat-window.ts",
  "features/vibemon/window-client": "vibemon-window.ts",
  "features/vibemon/main-host": "vibemon-main.ts",
  "lib/runtime": "runtime.ts",
  "lib/settings-bridge": "settings-bridge.ts",
  "features/auth/store": "auth.ts",
  "features/extensions/runtime": "extensions.ts",
  "features/drive/controller": "drive.ts",
  "features/workspace/html-preview": "html-preview.ts"
}

const config: StorybookConfig = {
  stories:
    process.env.ATLAS_LAYOUT_TEST === "1"
      ? ["./stories/pages/canvas-details.stories.tsx"]
      : ["./stories/page-boards/**/*.stories.tsx", "./stories/flows/**/*.stories.tsx"],
  docs: { defaultName: "说明文档" },
  staticDirs: [
    "../public",
    { from: "./assets", to: "/storybook-fixtures" },
    { from: "../node_modules/@alwith/module-auth/assets/vibemon", to: "/storybook-vibemon" }
  ],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: path.resolve(import.meta.dirname, "vite.config.ts") } }
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite")
    return mergeConfig(config, {
      define: {
        __ALWITH_APP_ENV__: JSON.stringify({
          apiBaseUrl: "https://api.example.test/service",
          webSsoBaseUrl: "https://example.test"
        })
      },
      server: { watch: { ignored: ["**/src-tauri/**", "**/storybook-static/**"] } },
      plugins: [
        {
          name: "storybook-host-boundaries",
          enforce: "pre",
          resolveId(source: string, importer: string | undefined) {
            if (source === "@alwith/module-voice/audio") return path.resolve(import.meta.dirname, "fixtures/voice.ts")
            const target = source.startsWith("@/")
              ? path.resolve(import.meta.dirname, "../src", source.slice(2))
              : source.startsWith(".") && importer
                ? path.resolve(path.dirname(importer.split("?")[0]), source)
                : source
            for (const [module, fixture] of Object.entries(boundaries)) {
              const file = path.resolve(import.meta.dirname, "../src", module)
              if (target === file || target === `${file}.ts` || target === `${file}.tsx`) {
                const mock = path.resolve(import.meta.dirname, "fixtures", fixture)
                if (importer?.split("?")[0] === mock) return
                return mock
              }
            }
          }
        },
        shadcn({ style: "vega", src: path.resolve(import.meta.dirname, "../src") }),
        tailwindcss()
      ],
      // Worker URLs must be transformed by Vite instead of dependency prebundling.
      optimizeDeps: {
        entries: [path.resolve(import.meta.dirname, "stories/**/*.stories.tsx")],
        exclude: ["@alwith/module-chat"],
        // The excluded module's CommonJS dependencies still need prebundling, as in vite.config.ts.
        include: [
          "@alwith/module-editor/tabs",
          "@alwith/module-editor/tabs/core",
          "@alwith/module-tabs/react",
          "@alwith/module-tabs/core",
          "@base-ui/react/radio",
          "@base-ui/react/radio-group",
          "diff2html",
          "diff2html/lib/types",
          "use-sync-external-store/shim",
          "use-sync-external-store/shim/with-selector"
        ]
      },
      resolve: {
        alias: {
          "@/lib/open": path.resolve(import.meta.dirname, "fixtures/open.ts")
        },
        dedupe: ["react", "react-dom", "@base-ui/react"]
      },
      envPrefix: "STORYBOOK_PUBLIC_"
    })
  },
  storySorts: [
    {
      order: [
        "页面",
        [
          "注册登录",
          [
            "验证码登录",
            ["正常主流程", "异常流程"],
            "密码登录",
            ["正常主流程", "异常流程"],
            "注册",
            ["正常主流程", "异常流程"]
          ],
          "侧栏导航",
          [
            "01 窗口与侧栏开关",
            "02 搜索",
            "03 聊天浮窗",
            "04 新聊天",
            ["所属项目", "正常状态", "异常状态", ["连接异常", "创建失败"]],
            "05 自定义",
            "06 Vibémon",
            "07 扩展入口",
            "08 收藏",
            "09 聊天",
            "10 活动",
            "11 云盘",
            [
              "01 账号与入口",
              ["@finture.id 账号 · 显示云盘标签", "其他邮箱账号 · 不显示云盘标签"],
              "02 配置与项目",
              ["云盘 · 尚未配置", "云盘 · 没有项目", "云盘 · 显示项目与资料库"],
              "03 同步状态",
              ["云盘 · 正在上传与下载", "云盘 · 同步暂停"],
              "04 连接与同步异常",
              ["云盘 · 连接断开", "云盘 · 同步错误", "云盘 · 上传失败详情", "云盘 · 文件冲突详情"]
            ],
            "12 更新提示",
            "13 推荐横幅",
            "14 屏幕切换",
            "15 账号菜单",
            [
              "01 查看账号",
              ["头像与昵称 · 展开完整用户菜单"],
              "02 创建与设备",
              ["创建应用 · 打开创建弹窗", "移动端连接 · 独立设置窗口内容", "Gamepad · 独立工具窗口内容"],
              "03 伙伴显示",
              [
                "已装扮且未开启 · 开启 Vibémon 入口",
                "伙伴已开启 · 关闭 Vibémon 入口",
                "未装扮伙伴 · 点击开启后的错误提醒"
              ],
              "04 语言与设置",
              ["语言 · 展开选项与当前语言", "设置 · 打开设置页"],
              "05 退出登录",
              ["退出登录 · 返回登录页面"]
            ],
            "16 帮助"
          ],
          "右侧隐藏屏",
          ["应用卡片", "浏览器连接", "工具窗口", "桌宠休息区"],
          "主窗整体",
          "主窗聊天",
          [
            "会话入口",
            ["01 新建会话", "02 打开已有会话", ["01 侧栏", "02 其他入口"]],
            "输入框",
            [
              "01 输入内容",
              ["01 文本输入", "02 图片附件", "03 文件引用", "04 长文本附件"],
              "02 输入框功能",
              ["01 权限模式", "02 模型选择", "03 上下文用量", "04 语音输入", "05 发送与停止"]
            ],
            "对话流",
            [
              "01 内容类型",
              [
                "01 用户发送",
                ["用户消息 · 纯文本", "用户消息 · 图片附件", "用户消息 · 文件引用"],
                "02 AI 回复",
                [
                  "纯文本回复",
                  "Markdown · 标题、列表与引用",
                  "表格回复",
                  "程序代码块 · TSX",
                  "HTML 源码 · 以代码块显示",
                  "数学公式 · 行内与独立公式",
                  "Mermaid 图表",
                  "网页链接与本地 MD 文件链接",
                  "文件资源 · PDF 与 CSV",
                  "本地图片链接 · 预览与文件入口",
                  "PNG 图片 · 预览与放大",
                  "SVG 图片资源 · 下载入口",
                  "多内容回复 · 文本、表格与代码"
                ],
                "03 消息操作",
                [
                  "回复操作 · 复制与创建分支",
                  "只读会话 · 创建聊天分叉",
                  "连接断开 · 暂不可创建分支",
                  "创建分支 · 进行中",
                  "分支聊天 · 返回原聊天",
                  "返回原聊天 · 原会话不可用",
                  "创建分支 · 失败"
                ]
              ],
              "02 执行状态",
              [
                "01 执行进程",
                [
                  "已发送 · 等待首次响应",
                  "任务计划 · 当前步骤与进度",
                  "正文生成中",
                  "执行中 · 用户补充指令",
                  "上下文压缩中",
                  "上下文压缩完成 · 继续执行",
                  "生成完成 · 回复已结束"
                ],
                "02 当前活动",
                [
                  "正在思考",
                  "正在搜索文件",
                  "正在搜索网页",
                  "正在编辑文件",
                  "正在运行命令",
                  "正在删除文件",
                  "正在移动文件",
                  "工具调用中 · 展开执行详情"
                ],
                "03 已执行活动",
                ["已执行活动汇总 · 继续思考"]
              ],
              "03 需要用户处理",
              ["等待操作授权", "异步问题 · 选择与补充", "表单请求 · 补充信息", "连接授权 · 外部服务入口"],
              "04 文件变更",
              [
                "单文件修改 · 查看变更",
                "多文件修改 · 查看变更",
                "撤销成功 · 可重新应用",
                "只读会话 · 不可撤销",
                "撤销失败 · 可重试",
                "部分撤销 · 可重试或重新应用"
              ],
              "05 历史与访问",
              ["历史恢复中", "历史多轮内容", "长会话 · 32轮", "只读会话"],
              "06 停止与异常",
              ["停止生成 · 首次回复前", "会话断开 · 可重新连接", "模型错误 · 可重试"],
              "07 文件预览"
            ],
            "顶部操作",
            [
              "01 项目与标题",
              "02 收藏",
              "03 更多操作",
              ["更多操作菜单", "重命名聊天", "在聊天中查找", "选择打开项目的应用", "删除聊天 · 确认"]
            ]
          ],
          "浮窗聊天",
          [
            "说明文档",
            "会话入口",
            ["01 新建会话", "02 打开已有会话"],
            "02 整体样式",
            "03 更多操作菜单",
            "04 连接提醒",
            "05 收起为桌宠"
          ],
          "文件树和预览区",
          [
            "01 文件预览",
            ["01 可以正常预览", "02 无法正常预览"],
            "02 文件操作",
            ["01 常用操作", ["文件夹右键菜单", "文件右键菜单"], "02 异常与恢复"]
          ],
          "负一屏",
          ["自定义", ["扩展", "插件", "技能"], "宠物", "已归档"],
          "设置页",
          "Gamepad",
          "其他"
        ],
        "流程",
        [
          "注册登录",
          "主窗整体",
          "主窗聊天",
          "浮窗聊天",
          "文件树和预览区",
          "负一屏",
          ["自定义", ["扩展", "插件", "技能"], "宠物", "已归档"],
          "设置页",
          "Gamepad",
          "其他"
        ]
      ],
      method: "alphabetical",
      locales: "zh-CN"
    }
  ]
}

export default config
