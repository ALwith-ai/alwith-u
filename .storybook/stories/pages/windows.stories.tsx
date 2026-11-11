import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-辅助窗口",
  title: "页面/其他/辅助窗口/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "guide" },
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

export const Guide: Story = { name: "用户指南" }
