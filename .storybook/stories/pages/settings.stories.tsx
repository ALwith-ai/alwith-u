import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import i18n from "../../../src/lib/i18n"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-设置",
  title: "页面/设置页/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "settings" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "Source components with isolated in-memory host data. Every example can be reset by selecting it again."
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const General: Story = { name: "通用", args: { settingsSection: "general" } }

export const Appearance: Story = { name: "外观", args: { settingsSection: "appearance" } }

export const Editor: Story = { name: "编辑器", args: { settingsSection: "editor" } }

export const Account: Story = { name: "账号资料", args: { settingsSection: "account" } }

export const Provider: Story = { name: "模型与供应商", args: { settingsSection: "provider" } }

export const Voice: Story = { name: "语音", args: { settingsSection: "voice" } }

export const Computer: Story = { name: "电脑操作", args: { settingsSection: "computer" } }

export const Extensions: Story = { name: "扩展", args: { settingsSection: "extensions" } }

export const Drive: Story = { name: "云盘", args: { settingsSection: "drive" } }

export const About: Story = { name: "关于", args: { settingsSection: "about" } }

export const CodexSignedOut: Story = {
  name: "模型账号未登录",
  args: { settingsSection: "provider", accountSignedIn: false }
}

export const ComputerEnabled: Story = {
  name: "电脑操作已启用",
  args: { settingsSection: "computer", computerCase: "enabled" }
}

export const ComputerPermissions: Story = {
  name: "电脑操作权限未授予",
  args: { settingsSection: "computer", computerCase: "permissions" }
}

export const ComputerUnavailable: Story = {
  name: "电脑操作模块不可用",
  args: { settingsSection: "computer", computerCase: "unavailable" }
}

export const DriveUnconfigured: Story = {
  name: "云盘未配置",
  args: { settingsSection: "drive", driveCase: "unconfigured" }
}

export const DrivePaused: Story = { name: "云盘已暂停", args: { settingsSection: "drive", driveCase: "paused" } }

export const AccountLoading: Story = {
  name: "模型账号加载中",
  args: { settingsSection: "provider", accountCase: "loading" }
}

export const AccountUnavailable: Story = {
  name: "模型账号不可用",
  args: { settingsSection: "provider", accountCase: "unavailable" }
}

export const ApiKeyAccount: Story = {
  name: "API 密钥账号",
  args: { settingsSection: "provider", accountCase: "apiKey" }
}

export const BedrockAccount: Story = {
  name: "Bedrock 账号",
  args: { settingsSection: "provider", accountCase: "bedrock" }
}

export const RateUnavailable: Story = {
  name: "额度暂不可用",
  args: { settingsSection: "provider", accountCase: "noLimits" }
}

export const RateEmpty: Story = {
  name: "没有额度窗口",
  args: { settingsSection: "provider", accountCase: "emptyLimits" }
}

export const RateExhausted: Story = {
  name: "额度已耗尽",
  args: { settingsSection: "provider", accountCase: "exhausted" }
}

export const ApiKeyLogin: Story = {
  name: "模型账号 · API 密钥登录弹窗",
  args: { settingsSection: "provider", accountSignedIn: false },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signInApiKey") }))
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
}
export const CodexSigningIn: Story = {
  name: "模型账号 · 浏览器登录等待",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signIn"), hidden: false }))
    await canvas.findByRole("status", { name: "Loading" })
  }
}
export const CodexDeviceSigningIn: Story = {
  name: "模型账号 · 设备码登录等待",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signInDevice") }))
    await canvas.findByRole("status", { name: "Loading" })
  }
}
export const CodexSigningOut: Story = {
  name: "模型账号 · 退出中",
  args: { settingsSection: "provider", accountCase: "signingOut" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signOut") }))
  }
}
export const CodexLoginError: Story = {
  name: "模型账号 · 登录失败",
  args: { settingsSection: "provider", accountSignedIn: false, accountCase: "error" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: i18n.t("connection.signIn") }))
    await within(canvasElement.ownerDocument.body).findByText("模拟身份验证失败，请重试。")
  }
}
