import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-vibémon",
  title: "页面/负一屏/Vibémon伙伴/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "vibemon" },
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

export const Home: Story = { name: "首页", args: { vibemonCase: "home" } }

export const Pull: Story = { name: "抽取页面", args: { vibemonCase: "pull" } }

export const Equip: Story = { name: "伙伴管理", args: { vibemonCase: "equip" } }

export const Empty: Story = { name: "未拥有伙伴", args: { vibemonCase: "empty" } }

export const Offline: Story = { name: "离线与重试", args: { vibemonCase: "offline" } }

export const SyncError: Story = { name: "资源同步失败", args: { vibemonCase: "syncError" } }

export const FirstVisit: Story = { name: "首次访问引导", args: { vibemonCase: "firstVisit" } }

export const Album: Story = {
  name: "伙伴图鉴",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Album" }))
  }
}
export const Insufficient: Story = { name: "积分不足", args: { vibemonCase: "insufficient" } }
export const DrawError: Story = {
  name: "抽取失败",
  args: { vibemonCase: "drawError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull once" }))
  }
}
