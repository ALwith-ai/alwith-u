import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { pluginsStore } from "../../../src/features/plugins/instance"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-插件-操作与失败恢复",
  title: "页面/负一屏/插件/操作与失败恢复",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "plugins" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Installing: Story = {
  name: "安装处理中",
  args: { pluginOperation: "installing" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Documents" }))
    await userEvent.click(await canvas.findByRole("button", { name: /^安装/ }))
    await waitFor(() => expect(Object.values(pluginsStore.getState().busyIds)).toContain("installing"))
  }
}
export const InstallError: Story = {
  ...Installing,
  name: "安装失败",
  args: { pluginOperation: "installError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Documents" }))
    await userEvent.click(await canvas.findByRole("button", { name: /^安装/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await expect(pluginsStore.getState().installed.some((item) => item.plugin.name === "documents")).toBe(false)
  }
}
export const InstallRetry: Story = {
  ...InstallError,
  name: "安装失败 → 重试成功",
  play: async (context) => {
    await InstallError.play!(context)
    await context.userEvent.click(within(context.canvasElement).getByRole("button", { name: /^安装/ }))
    await waitFor(() =>
      expect(pluginsStore.getState().installed.some((item) => item.plugin.name === "documents")).toBe(true)
    )
  }
}
export const Toggling: Story = {
  name: "启停处理中",
  args: { pluginOperation: "toggling" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click(await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await waitFor(() => expect(Object.values(pluginsStore.getState().busyIds)).toContain("toggling"))
  }
}
export const ToggleError: Story = {
  ...Toggling,
  name: "启停失败 · 回滚状态",
  args: { pluginOperation: "toggleError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click(await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await expect(
      pluginsStore.getState().installed.find((item) => item.plugin.name === "spreadsheets")?.plugin.enabled
    ).toBe(true)
  }
}
export const Uninstalling: Story = {
  name: "卸载处理中",
  args: { pluginOperation: "uninstalling" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click((await canvas.findAllByRole("button", { name: "更多操作" }))[0]!)
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: /卸载/ }))
    await waitFor(() => expect(Object.values(pluginsStore.getState().busyIds)).toContain("uninstalling"))
  }
}
export const UninstallError: Story = {
  ...Uninstalling,
  name: "卸载失败 · 保留插件",
  args: { pluginOperation: "uninstallError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click((await canvas.findAllByRole("button", { name: "更多操作" }))[0]!)
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: /卸载/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await expect(pluginsStore.getState().installed).toHaveLength(2)
  }
}
export const UninstallRetry: Story = {
  ...UninstallError,
  name: "卸载失败 → 重试成功",
  play: async (context) => {
    await UninstallError.play!(context)
    const canvas = within(context.canvasElement)
    await context.userEvent.click(canvas.getAllByRole("button", { name: "更多操作" })[0]!)
    await context.userEvent.click(
      await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name: /卸载/ })
    )
    await waitFor(() => expect(pluginsStore.getState().installed).toHaveLength(1))
  }
}
export const Upgrading: Story = {
  name: "升级处理中",
  args: { pluginOperation: "upgrading" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "升级" }))
    await waitFor(() => expect(pluginsStore.getState().upgrading).toBe(true))
  }
}
export const UpgradeError: Story = {
  ...Upgrading,
  name: "升级失败",
  args: { pluginOperation: "upgradeError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "升级" }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await expect(pluginsStore.getState().upgrading).toBe(false)
  }
}
export const UpgradeRetry: Story = {
  ...UpgradeError,
  name: "升级失败 → 重试成功",
  play: async (context) => {
    await UpgradeError.play!(context)
    await context.userEvent.click(within(context.canvasElement).getByRole("button", { name: "升级" }))
    await waitFor(() => expect(pluginsStore.getState().upgrading).toBe(false))
  }
}
export const SkillError: Story = {
  name: "技能启停失败",
  args: { pluginOperation: "skillError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click((await canvas.findAllByRole("switch", { name: "禁用技能" }))[0]!)
    await within(canvasElement.ownerDocument.body).findByText(/模拟技能启停失败/)
    await expect(pluginsStore.getState().skills[0]?.enabled).toBe(true)
  }
}
