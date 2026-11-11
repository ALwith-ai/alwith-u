import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-扩展",
  title: "页面/负一屏/自定义/扩展/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "extensions" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Installed: Story = {
  name: "已启用与已停用",
  parameters: { pageStateGroup: "扩展状态" }
}

export const Empty: Story = { name: "未安装扩展", args: { extensionCase: "empty" } }

export const Loading: Story = { name: "加载中", args: { extensionCase: "loading" } }

export const Pending: Story = { name: "等待扩展重载", args: { extensionCase: "pending" } }

export const NoResults: Story = {
  name: "搜索无结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("searchbox"), "no-match-extension-937")
  }
}

export const Unavailable: Story = {
  name: "扩展页面不可用",
  args: { page: "extension" },
  parameters: { pageStateGroup: "扩展状态" }
}

export const StartupError: Story = { name: "启动失败", args: { extensionCase: "failed" } }
export const ServiceError: Story = { name: "服务异常", args: { extensionCase: "error" } }

export const RenderError: Story = {
  name: "扩展渲染失败与重试",
  args: { page: "extension", extensionCase: "renderError", extensionId: "demo-0/demo-content" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "重试" }))
    await canvas.findByRole("heading", { name: "扩展内容已恢复" })
  }
}
