import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-插件-插件详情",
  title: "页面/负一屏/插件/插件详情",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "pluginDetail" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "Source components with isolated in-memory host data. Every example can be reset by selecting it again."
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = { name: "未安装 · 详情与能力" }

export const Installed: Story = { name: "已安装 · 开关与卸载", args: { pluginCase: "installed" } }

export const Unavailable: Story = { name: "不可用 · 套餐限制", args: { pluginCase: "unavailable" } }

export const Failed: Story = { name: "详情加载失败", args: { pluginCase: "detailError" } }
