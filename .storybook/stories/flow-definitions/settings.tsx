import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { settingsStore } from "../../../src/lib/settings-store"
import { computerStatus, nativeCalls } from "../../fixtures/native"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/设置页/设置与能力",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "settings", settingsSection: "general" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Sections: Story = {
  name: "通用 → 外观 → 编辑器 → 账号 → 模型 → 语音 → 电脑 → 扩展 → 云盘 → 关于",
  play: async ({ canvas, userEvent, step }) => {
    for (const name of ["通用", "外观", "编辑器", "账户", "模型提供方", "语音", "操作电脑", "应用扩展", "云盘", "关于"])
      await step(name, async () => {
        await userEvent.click(canvas.getByRole("button", { name }))
        await expect(canvas.getByRole("region", { name })).toBeVisible()
      })
  }
}
export const Theme: Story = {
  name: "外观 → 深色 → 浅色",
  args: { settingsSection: "appearance" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "深色" }))
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"))
    await userEvent.click(canvas.getByRole("button", { name: "浅色" }))
    await waitFor(() => expect(document.documentElement).toHaveClass("light"))
  }
}
export const Computer: Story = {
  name: "操作电脑 → 启用 → 停用",
  args: { settingsSection: "computer" },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch")
    await waitFor(() => expect(toggle).not.toBeDisabled())
    await userEvent.click(toggle)
    await waitFor(() => expect(computerStatus.enabled).toBe(true))
    await waitFor(() => expect(toggle).toBeChecked(), { timeout: 3000 })
    await userEvent.click(toggle)
    await waitFor(() => expect(computerStatus.enabled).toBe(false))
  }
}
export const ComputerPermission: Story = {
  name: "缺少系统权限 → 打开权限设置",
  args: { settingsSection: "computer", computerCase: "permissions" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await canvas.findAllByRole("button", { name: "打开系统设置" }))[0]!)
    await waitFor(() => expect(nativeCalls.some((call) => call.command === "computer_request_permissions")).toBe(true))
  }
}
export const Provider: Story = {
  name: "模型提供方 → 输入密钥 → 保存 → 测试",
  args: { settingsSection: "provider" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const key = await body
      .findAllByPlaceholderText("粘贴 API 密钥")
      .then((fields) => fields.find((field) => !field.closest("[hidden]"))!)
    await userEvent.type(key, "storybook-demo-key")
    await userEvent.click(body.getByRole("button", { name: "保存" }))
    await userEvent.click(await body.findByRole("button", { name: /测试连接/ }))
    await body.findByRole("status")
  }
}

export const Voice: Story = {
  name: "语音 → 启用 → 保存配置",
  args: { settingsSection: "voice" },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", { name: "启用语音输入" })
    await userEvent.click(toggle)
    await waitFor(() => expect(settingsStore.get("voice.enabled")).toBe(true))
    await userEvent.click(await canvas.findByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        nativeCalls.some(
          (call) =>
            call.command === "settings_request" &&
            (call.payload as { input?: { action?: string } })?.input?.action === "saveVoice"
        )
      ).toBe(true)
    )
  }
}
export const Editor: Story = {
  name: "编辑器 → 调整显示和排版",
  args: { settingsSection: "editor" },
  play: async ({ canvas, userEvent }) => {
    const wrap = await canvas.findByRole("switch", { name: "自动换行" })
    const checked = wrap.getAttribute("aria-checked")
    await userEvent.click(wrap)
    await waitFor(() => expect(wrap.getAttribute("aria-checked")).not.toBe(checked))
  }
}
