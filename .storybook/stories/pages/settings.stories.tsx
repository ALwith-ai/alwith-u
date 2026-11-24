import type { ComponentProps } from "react"
import { within } from "storybook/test"

import i18n from "../../../src/lib/i18n"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "settings" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component: "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-设置",
  title: "页面/设置页/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const General = meta.story({ name: "通用", args: { settingsSection: "general" } })

export const Appearance = meta.story({ name: "外观", args: { settingsSection: "appearance" } })

export const Editor = meta.story({ name: "编辑器", args: { settingsSection: "editor" } })

export const Account = meta.story({ name: "账号资料", args: { settingsSection: "account" } })

export const Provider = meta.story({ name: "模型与供应商", args: { settingsSection: "provider" } })

export const Voice = meta.story({ name: "语音", args: { settingsSection: "voice" } })

export const Computer = meta.story({ name: "电脑操作", args: { settingsSection: "computer" } })

export const Extensions = meta.story({ name: "扩展", args: { settingsSection: "extensions" } })

export const Drive = meta.story({ name: "云盘", args: { settingsSection: "drive" } })

export const About = meta.story({ name: "关于", args: { settingsSection: "about" } })

export const CodexSignedOut = meta.story({
  name: "模型账号未登录",
  args: { settingsSection: "provider", accountSignedIn: false }
})

export const ComputerEnabled = meta.story({
  name: "电脑操作已启用",
  args: { settingsSection: "computer", computerCase: "enabled" }
})

export const ComputerPermissions = meta.story({
  name: "电脑操作权限未授予",
  args: { settingsSection: "computer", computerCase: "permissions" }
})

export const ComputerUnavailable = meta.story({
  name: "电脑操作模块不可用",
  args: { settingsSection: "computer", computerCase: "unavailable" }
})

export const DriveUnconfigured = meta.story({
  name: "云盘未配置",
  args: { settingsSection: "drive", driveCase: "unconfigured" }
})

export const DrivePaused = meta.story({ name: "云盘已暂停", args: { settingsSection: "drive", driveCase: "paused" } })

export const AccountLoading = meta.story({
  name: "模型账号加载中",
  args: { settingsSection: "provider", accountCase: "loading" }
})

export const AccountUnavailable = meta.story({
  name: "模型账号不可用",
  args: { settingsSection: "provider", accountCase: "unavailable" }
})

export const ApiKeyAccount = meta.story({
  name: "API 密钥账号",
  args: { settingsSection: "provider", accountCase: "apiKey" }
})

export const BedrockAccount = meta.story({
  name: "Bedrock 账号",
  args: { settingsSection: "provider", accountCase: "bedrock" }
})

export const RateUnavailable = meta.story({
  name: "额度暂不可用",
  args: { settingsSection: "provider", accountCase: "noLimits" }
})

export const RateEmpty = meta.story({
  name: "没有额度窗口",
  args: { settingsSection: "provider", accountCase: "emptyLimits" }
})

export const RateExhausted = meta.story({
  name: "额度已耗尽",
  args: { settingsSection: "provider", accountCase: "exhausted" }
})

export const ApiKeyLogin = meta.story({
  name: "模型账号 · API 密钥登录弹窗",
  args: { settingsSection: "provider", accountSignedIn: false },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signInApiKey") }))
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
})
export const CodexSigningIn = meta.story({
  name: "模型账号 · 浏览器登录等待",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signIn"), hidden: false }))
    await canvas.findByRole("status", { name: "Loading" })
  }
})
export const CodexDeviceSigningIn = meta.story({
  name: "模型账号 · 设备码登录等待",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signInDevice") }))
    await canvas.findByRole("status", { name: "Loading" })
  }
})
export const CodexSigningOut = meta.story({
  name: "模型账号 · 退出中",
  args: { settingsSection: "provider", accountCase: "signingOut" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signOut") }))
  }
})
export const CodexLoginError = meta.story({
  name: "模型账号 · 登录失败",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "error" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signIn") }))
    await within(canvasElement.ownerDocument.body).findByText("模拟身份验证失败，请重试。")
  }
})
