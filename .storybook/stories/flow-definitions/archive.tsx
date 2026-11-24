import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "archives" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/负一屏/已归档",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Restore = meta.story({
  name: "归档列表 → 恢复聊天 → 返回列表",
  play: async ({ canvas, userEvent }) => {
    const count = client.state.archivedSessions.length
    await userEvent.click((await canvas.findAllByRole("button", { name: "取消归档" }))[0])
    await waitFor(() => expect(client.state.archivedSessions).toHaveLength(count - 1))
  }
})
export const DeleteOne = meta.story({
  name: "归档列表 → 删除单条 → 确认",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const count = client.state.archivedSessions.length
    await userEvent.click((await body.findAllByRole("button", { name: "删除" }))[0])
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "永久删除" }))
    await waitFor(() => expect(client.state.archivedSessions).toHaveLength(count - 1))
  }
})
export const DeleteAll = meta.story({
  name: "归档列表 → 全部删除 → 空状态",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "全部删除" }))
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "永久删除" }))
    await waitFor(() => expect(client.state.archivedSessions).toHaveLength(0))
  }
})
export const CancelDelete = meta.story({
  name: "归档列表 → 全部删除 → 取消",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const count = client.state.archivedSessions.length
    await userEvent.click(await body.findByRole("button", { name: "全部删除" }))
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: "取消" }))
    await expect(client.state.archivedSessions).toHaveLength(count)
  }
})
export const Search = meta.story({
  name: "归档列表 → 搜索 → 无结果 → 清空",
  play: async ({ canvas, userEvent }) => {
    const field = await canvas.findByRole("textbox", { name: "搜索已归档的聊天" })
    await userEvent.type(field, "no-match-937")
    await expect(field).toHaveValue("no-match-937")
    await userEvent.clear(field)
    await canvas.findAllByRole("button", { name: "取消归档" })
  }
})
export const Filter = meta.story({
  name: "归档列表 → 按类型和项目筛选",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("combobox", { name: "聊天类型" }))
    await userEvent.click(await body.findByRole("option", { name: "项目聊天" }))
    await body.findAllByRole("button", { name: "取消归档" })
  }
})
