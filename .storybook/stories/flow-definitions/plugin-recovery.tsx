import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { pluginsStore } from "../../../src/features/plugins/instance"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "plugins" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/负一屏/自定义/插件/失败恢复",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Install = meta.story({
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
})
export const Toggle = meta.story({
  name: "停用插件 → 失败回滚 → 重试成功",
  args: { pluginOperation: "toggleError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
    await userEvent.click(await canvas.findByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getByRole("switch", { name: /禁用.*Spreadsheets/ }))
    await canvas.findByRole("switch", { name: /启用.*Spreadsheets/ })
  }
})
export const Uninstall = meta.story({
  name: "卸载插件 → 失败保留 → 重试成功",
  args: { pluginOperation: "uninstallError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
    await userEvent.click(await body.findByRole("button", { name: /卸载/ }))
    await body.findByText(/模拟插件操作失败/)
    await userEvent.click(await body.findByRole("button", { name: /卸载/ }))
    await waitFor(() => expect(pluginsStore.getState().installed).toHaveLength(1))
  }
})
export const Upgrade = meta.story({
  name: "升级目录 → 失败 → 重试成功",
  args: { pluginOperation: "upgradeError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "升级" }))
    await within(canvasElement.ownerDocument.body).findByText(/模拟插件操作失败/)
    await userEvent.click(canvas.getByRole("button", { name: "升级" }))
    await waitFor(() => expect(pluginsStore.getState().upgrading).toBe(false))
  }
})
