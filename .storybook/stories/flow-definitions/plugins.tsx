import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { pluginsStore } from "../../../src/features/plugins/instance"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/负一屏/插件",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "plugins" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Install: Story = {
  name: "插件市场 → 详情 → 安装 → 已安装",
  play: async ({ canvasElement, userEvent, step }) => {
    const body = within(canvasElement.ownerDocument.body)
    await step("查看插件详情", async () => {
      await userEvent.click(await body.findByRole("button", { name: "Documents" }))
      await body.findByRole("heading", { name: "Documents" })
    })
    await step("安装插件", async () => {
      await userEvent.click(await body.findByRole("button", { name: /安装/ }))
      await waitFor(() =>
        expect(pluginsStore.getState().installed.some((entry) => entry.plugin.name === "documents")).toBe(true)
      )
    })
  }
}
export const Toggle: Story = {
  name: "已安装 → 停用 → 启用",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
    await userEvent.click(await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await canvas.findByRole("switch", { name: /启用.*Spreadsheets/ })
    await userEvent.click(canvas.getByRole("switch", { name: /启用.*Spreadsheets/ }))
    await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ })
  }
}
export const Uninstall: Story = {
  name: "已安装 → 详情 → 卸载",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(body.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
    await userEvent.click(await body.findByRole("button", { name: /卸载/ }))
    await waitFor(() => expect(pluginsStore.getState().installed).toHaveLength(1))
  }
}
export const SkillToggle: Story = {
  name: "已安装 → 技能停用与启用",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "技能" }))
    await userEvent.click(await canvas.findByRole("button", { name: "project-review" }))
    const switches = await within(document.body).findAllByRole("switch", { name: /^禁用技能:/ })
    await userEvent.click(switches[0]!)
    await waitFor(() => expect(pluginsStore.getState().skills[0]?.enabled).toBe(false))
  }
}
export const Search: Story = {
  name: "插件市场 → 搜索 → 无匹配 → 恢复",
  play: async ({ canvas, userEvent }) => {
    const search = await canvas.findByPlaceholderText("搜索插件")
    await userEvent.type(search, "no-match-937")
    await canvas.findByText("未找到插件")
    await userEvent.clear(search)
    await canvas.findByText("Documents")
  }
}
export const Upgrade: Story = {
  name: "插件市场 → 升级目录 → 返回结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "升级" }))
    await waitFor(() => expect(pluginsStore.getState().upgrading).toBe(false))
  }
}
export const ExtensionEnable: Story = {
  name: "扩展管理 → 启用扩展 → 停用",
  args: { page: "extensions" },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", { name: /资料助手/ })
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
  }
}
export const ExtensionUnavailable: Story = {
  name: "扩展入口 → 不可用 → 返回管理",
  args: { page: "extension" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "返回聊天" }))
    await canvas.findByRole("searchbox")
  }
}

export const ExtensionInstall: Story = {
  name: "扩展管理 → 安装 → 自动启用",
  args: { page: "extensions" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "从本地目录安装" }))
    await canvas.findByText("交付助手")
    const toggle = await canvas.findByRole("switch", { name: /交付助手/ })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    await waitFor(() => expect(toggle).toBeChecked())
  }
}
