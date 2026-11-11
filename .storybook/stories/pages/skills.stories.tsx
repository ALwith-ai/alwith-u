import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-技能",
  title: "页面/负一屏/自定义/技能/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "plugins" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = {
  name: "技能列表",
  parameters: { pageStateGroup: "技能状态" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await canvas.findByPlaceholderText("搜索技能")
  }
}
export const Empty: Story = {
  name: "没有技能",
  parameters: { pageStateGroup: "技能状态" },
  args: { pluginCase: "empty" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await canvas.findByText("找不到技能")
  }
}
export const NoResults: Story = {
  name: "搜索无结果",
  parameters: { pageStateGroup: "技能状态" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "技能" }))
    await userEvent.type(await canvas.findByPlaceholderText("搜索技能"), "no-match-skill-937")
  }
}
