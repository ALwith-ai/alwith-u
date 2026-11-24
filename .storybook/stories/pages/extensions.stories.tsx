import type { ComponentProps } from "react"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "extensions" },
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
  id: "页面-扩展",
  title: "页面/负一屏/自定义/扩展/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Installed = meta.story({
  name: "已启用与已停用",
  parameters: { pageStateGroup: "扩展状态" }
})

export const Empty = meta.story({ name: "未安装扩展", args: { extensionCase: "empty" } })

export const Loading = meta.story({ name: "加载中", args: { extensionCase: "loading" } })

export const Pending = meta.story({ name: "等待扩展重载", args: { extensionCase: "pending" } })

export const NoResults = meta.story({
  name: "搜索无结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "no-match-extension-937")
  }
})

export const Unavailable = meta.story({
  name: "扩展页面不可用",
  args: { page: "extension" },
  parameters: { pageStateGroup: "扩展状态" }
})

export const StartupError = meta.story({ name: "启动失败", args: { extensionCase: "failed" } })
export const ServiceError = meta.story({ name: "服务异常", args: { extensionCase: "error" } })

export const RenderError = meta.story({
  name: "扩展渲染失败与重试",
  args: { page: "extension", extensionCase: "renderError", extensionId: "demo-0/demo-content" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "重试" }))
    await canvas.findByRole("heading", { name: "扩展内容已恢复" })
  }
})
