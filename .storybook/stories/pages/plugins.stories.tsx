import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-插件-插件列表",
  title: "页面/负一屏/插件/插件列表",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "plugins" },
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

export const Marketplace: Story = { name: "插件市场" }

export const Installed: Story = {
  name: "已安装插件与技能",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      within(canvas.getByRole("navigation", { name: "已安装" })).getByRole("button", { name: "Spreadsheets" })
    )
  }
}

export const Empty: Story = { name: "插件与技能均为空", args: { pluginCase: "empty" } }

export const Loading: Story = { name: "加载中", args: { pluginCase: "loading" } }

export const Failed: Story = { name: "加载失败与重试", args: { pluginCase: "error" } }

export const NoResults: Story = {
  name: "搜索无结果",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByPlaceholderText(/搜索/), "no-match-plugin-937")
  }
}
