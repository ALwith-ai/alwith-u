import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project", sidebarView: "drive" },
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
  id: "页面-云盘",
  title: "页面/其他/云盘/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Projects = meta.story({ name: "项目与资料库", args: { driveCase: "ready" } })

export const Empty = meta.story({ name: "没有项目", args: { driveCase: "empty" } })

export const Unconfigured = meta.story({ name: "尚未配置", args: { driveCase: "unconfigured" } })

export const Offline = meta.story({ name: "连接断开", args: { driveCase: "offline" } })

export const Error = meta.story({ name: "同步错误", args: { driveCase: "error" } })

export const Paused = meta.story({ name: "同步暂停", args: { driveCase: "paused" } })

export const MassDelete = meta.story({ name: "批量删除云端文件确认", args: { driveCase: "massDelete" } })
export const MassDeleteError = meta.story({
  name: "批量删除确认失败",
  args: { driveCase: "deleteError" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getAllByRole("button").at(-1)!)
    await waitFor(async () => expect(await dialog.findByRole("alert")).toBeVisible())
  }
})
export const Syncing = meta.story({ name: "正在上传与下载", args: { driveCase: "syncing" } })
export const FailedUploads = meta.story({
  name: "上传失败详情",
  args: { driveCase: "failedUploads" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
})
export const Conflicts = meta.story({ ...FailedUploads.input, name: "文件冲突详情", args: { driveCase: "conflict" } })
