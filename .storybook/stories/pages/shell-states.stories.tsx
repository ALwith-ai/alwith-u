import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { zoomIn, zoomStore } from "../../../src/lib/zoom"
import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"

const meta = {
  id: "页面-主窗口完整状态",
  title: "页面/主窗整体/主窗状态/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const GlobalAuthorization: Story = {
  name: "全局连接授权",
  args: { globalAction: "url" },
  play: async ({ canvas }) => {
    await canvas.findByRole("button", { name: /打开链接/ })
  }
}
export const GlobalAuthorizationOnLeading: Story = {
  ...GlobalAuthorization,
  name: "管理页中的全局连接授权",
  args: { page: "plugins", globalAction: "url" }
}
export const GlobalForm: Story = {
  name: "全局表单",
  args: { globalAction: "form" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  }
}
export const GlobalFormQueue: Story = {
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
}
export const ExtensionEntry: Story = {
  name: "扩展入口导航",
  args: { extensionCase: "content" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "项目工具" }))
    await within(canvasElement.ownerDocument.body).findByText("项目工具已就绪")
  }
}
export const ExtensionNavigation: Story = {
  name: "扩展导航与状态栏",
  args: { page: "extensions", extensionCase: "content" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("项目工具已就绪")
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "功能导航" })).getByRole("button", { name: "项目工具" })
    )
    await canvas.findByRole("navigation", { name: "Guide chapters" })
  }
}
export const ExtensionSettings: Story = {
  name: "设置中的扩展分区",
  args: { page: "settings", extensionCase: "content" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "项目工具 · 设置" }))
    await canvas.findByRole("region", { name: "项目工具 · 设置" })
  }
}
export const WallpaperCover: Story = {
  name: "壁纸 · 填充",
  args: { wallpaper: "cover" },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector<HTMLImageElement>(".wallpaper-background")?.naturalWidth).toBe(1200)
    )
  }
}
export const WallpaperContain: Story = {
  ...WallpaperCover,
  name: "壁纸 · 适应",
  args: { wallpaper: "contain" }
}
export const WallpaperError: Story = {
  name: "壁纸加载失败",
  args: { wallpaper: "error" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByText(/Wallpaper image could not be loaded/)
  }
}
export const Windows: Story = {
  name: "Windows 主窗口与文件工具栏",
  args: { platform: "windows", file: "README.md" },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole("button", { name: "源码" })
    expect(canvasElement.querySelector(".windows-main-titlebar")).toBeVisible()
  }
}
export const Linux: Story = {
  name: "Linux 主窗口",
  args: { platform: "linux" },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector(".windows-main-titlebar")).toBeNull()
  }
}
export const ZoomFeedback: Story = {
  name: "缩放提示 · 放大与还原",
  play: async ({ canvasElement, userEvent }) => {
    await workflowAction("放大窗口", () => zoomIn())
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText("110%")
    await userEvent.click(body.getByRole("button", { name: /重置|还原|实际大小/ }))
    await waitFor(() => expect(zoomStore.getState().level).toBe(1))
  }
}
