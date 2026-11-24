import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "archives" },
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
  id: "页面-聊天归档",
  title: "页面/负一屏/已归档/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const List = meta.story({ name: "归档列表" })

export const Empty = meta.story({ name: "没有归档", args: { archiveCase: "empty" } })

export const Loading = meta.story({ name: "加载中", args: { archiveCase: "loading" } })

export const Many = meta.story({ name: "大量归档 · 滚动", args: { archiveCase: "many" } })

export const NoResults = meta.story({
  name: "搜索无匹配",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "搜索已归档的聊天" }), "no-match-937")
  }
})

export const DeleteAll = meta.story({
  name: "全部删除确认",
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole("button", { name: "全部删除" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
  }
})

export const LoadError = meta.story({
  name: "加载失败与重试",
  args: { archiveCase: "loadError" },
  play: async ({ canvas }) => {
    await canvas.findByRole("alert")
  }
})
export const RestoreError = meta.story({
  name: "恢复失败",
  args: { archiveCase: "restoreError" },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "取消归档" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0])
    await canvas.findByRole("alert")
  }
})
export const Restoring = meta.story({
  ...RestoreError.input,
  name: "恢复中",
  args: { archiveCase: "restoring" },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "取消归档" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0])
    await expect(buttons[0]).toBeDisabled()
  }
})
export const DeleteError = meta.story({
  name: "单条删除失败",
  args: { archiveCase: "deleteError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "删除" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0])
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await dialog.findByRole("alert")
  }
})
export const Deleting = meta.story({
  ...DeleteError.input,
  name: "单条删除中",
  args: { archiveCase: "deleting" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "删除" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0])
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await expect(dialog.getByRole("button", { name: /删除/ })).toBeDisabled()
  }
})
export const PartialDelete = meta.story({
  name: "批量删除部分失败 · 保留失败项",
  args: { archiveCase: "partialDelete" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const button = await canvas.findByRole("button", { name: "全部删除" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await dialog.findByRole("alert")
  }
})
