import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "settings", settingsSection: "about" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } },
  argTypes: productPreviewArgTypes
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  id: "页面-设置-应用更新",
  title: "页面/设置页/应用更新",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Idle = meta.story({ name: "当前版本", args: { updateCase: "idle" } })
export const Disabled = meta.story({ name: "更新未配置", args: { updateCase: "disabled" } })
export const Checking = meta.story({ name: "检查更新中", args: { updateCase: "checkingForUpdates" } })
export const Downloading = meta.story({ name: "下载中 · 42%", args: { updateCase: "downloading" } })
export const Indeterminate = meta.story({ name: "下载中 · 未知大小", args: { updateCase: "indeterminate" } })
export const Ready = meta.story({ name: "下载完成 · 等待重启", args: { updateCase: "ready" } })
export const Restarting = meta.story({ name: "重启安装中", args: { updateCase: "restarting" } })
export const SidebarDownloading = meta.story({
  name: "侧栏更新下载进度",
  args: { page: "chat", chatCase: "conversation", updateCase: "downloading" }
})
export const SidebarReady = meta.story({
  name: "侧栏可安装更新",
  args: { page: "chat", chatCase: "conversation", updateCase: "ready" }
})
