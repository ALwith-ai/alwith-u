import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { pluginsStore } from "../../../src/features/plugins/instance"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/负一屏/插件/失败恢复",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "plugins" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Install: Story = {
  name: "安装插件 → 失败 → 重试成功",
  args: { pluginOperation: "installError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Documents" }))
    await userEvent.click(await canvas.findByRole("button", { name: /^安装/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getByRole("button", { name: /^安装/ }))
    await waitFor(() =>
      expect(pluginsStore.getState().installed.some((item) => item.plugin.name === "documents")).toBe(true)
    )
  }
}
export const Toggle: Story = {
  name: "停用插件 → 失败回滚 → 重试成功",
  args: { pluginOperation: "toggleError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click(await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await canvas.findByRole("switch", { name: /启用.*Spreadsheets/ })
  }
}
export const Uninstall: Story = {
  name: "卸载插件 → 失败保留 → 重试成功",
  args: { pluginOperation: "uninstallError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("tab", { name: "已安装" }))
    await userEvent.click((await canvas.findAllByRole("button", { name: "更多操作" }))[0]!)
    await userEvent.click(await body.findByRole("menuitem", { name: /卸载/ }))
    await body.findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getAllByRole("button", { name: "更多操作" })[0]!)
    await userEvent.click(await body.findByRole("menuitem", { name: /卸载/ }))
    await waitFor(() => expect(pluginsStore.getState().installed).toHaveLength(1))
  }
}
export const Upgrade: Story = {
  name: "升级目录 → 失败 → 重试成功",
  args: { pluginOperation: "upgradeError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "升级" }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getByRole("button", { name: "升级" }))
    await waitFor(() => expect(pluginsStore.getState().upgrading).toBe(false))
  }
}
