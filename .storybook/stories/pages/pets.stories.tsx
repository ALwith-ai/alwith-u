import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-vibémon",
  title: "页面/负一屏/宠物伙伴/页面状态",
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

export const Home: Story = { name: "首页", args: { petCase: "home" } }

export const Pull: Story = { name: "抽取页面", args: { petCase: "pull" } }

export const Equip: Story = { name: "伙伴管理", args: { petCase: "equip" } }

export const Empty: Story = { name: "未拥有伙伴", args: { petCase: "empty" } }

export const Offline: Story = { name: "离线与重试", args: { petCase: "offline" } }

export const SyncError: Story = { name: "资源同步失败", args: { petCase: "syncError" } }

export const FirstVisit: Story = { name: "首次访问引导", args: { petCase: "firstVisit" } }

export const Album: Story = {
  name: "伙伴图鉴",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Album" }))
  }
}
export const Insufficient: Story = { name: "积分不足", args: { petCase: "insufficient" } }
export const DrawError: Story = {
  name: "抽取失败",
  args: { petCase: "drawError" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull once" }))
  }
}
