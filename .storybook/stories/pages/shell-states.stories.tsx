import { zoomIn, zoomLevel } from "@alwith/module-desktop-shell/zoom"
import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-主窗口完整状态",
  title: "页面/主窗整体/主窗状态/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const GlobalAuthorization = meta.story({
  name: "全局连接授权",
  args: { globalAction: "url" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: /打开链接/ })
  }
})
export const GlobalAuthorizationOnLeading = meta.story({
  ...GlobalAuthorization.input,
  name: "管理页中的全局连接授权",
  args: { page: "plugins", globalAction: "url" }
})
export const GlobalForm = meta.story({
  name: "全局表单",
  args: { globalAction: "form" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
})
export const GlobalFormQueue = meta.story({
  name: "全局表单队列 · 逐一取消",
  args: { globalAction: "multipleForms" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(client.state.actions).toHaveLength(1))
    await body.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(client.state.actions).toHaveLength(0))
  }
})
export const ExtensionEntry = meta.story({
  name: "扩展入口导航",
  args: { extensionCase: "content" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "项目工具" }))
    await within(canvasElement.ownerDocument.body).findByText("项目工具已就绪")
  }
})
export const ExtensionNavigation = meta.story({
  name: "扩展导航与状态栏",
  args: { page: "extensions", extensionCase: "content" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("项目工具已就绪")
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "功能导航" })).getByRole("button", { name: "项目工具" })
    )
    await canvas.findByRole("navigation", { name: "Guide chapters" })
  }
})
export const ExtensionSettings = meta.story({
  name: "设置中的扩展分区",
  args: { page: "settings", extensionCase: "content" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "项目工具 · 设置" }))
    await canvas.findByRole("region", { name: "项目工具 · 设置" })
  }
})
export const WallpaperCover = meta.story({
  name: "壁纸 · 填充",
  args: { wallpaper: "cover" },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector<HTMLImageElement>(".wallpaper-background")?.naturalWidth).toBe(1200)
    )
  }
})
export const WallpaperContain = meta.story({
  ...WallpaperCover.input,
  name: "壁纸 · 适应",
  args: { wallpaper: "contain" }
})
export const WallpaperError = meta.story({
  name: "壁纸加载失败",
  args: { wallpaper: "error" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByText(/Wallpaper image could not be loaded/)
  }
})
export const Windows = meta.story({
  name: "Windows 主窗口与文件工具栏",
  args: { platform: "windows", file: "README.md" },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("button", { name: "源码" })
    await expect(canvasElement.querySelector(".windows-main-titlebar")).toBeVisible()
  }
})
export const Linux = meta.story({
  name: "Linux 主窗口",
  args: { platform: "linux" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".windows-main-titlebar")).toBeNull()
  }
})
export const ZoomFeedback = meta.story({
  name: "缩放提示 · 放大与还原",
  play: async ({ canvasElement, userEvent }) => {
    await workflowAction("放大窗口", () => zoomIn())
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText("110%")
    await userEvent.click(body.getByRole("button", { name: /重置|还原|实际大小/ }))
    await waitFor(() => expect(zoomLevel()).toBe(1))
  }
})
