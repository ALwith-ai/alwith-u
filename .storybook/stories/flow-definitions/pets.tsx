import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
const meta = {
  title: "流程/负一屏/宠物伙伴",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "vibemon" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Wish: Story = {
  name: "首页 → Wish → 卡池",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Wish" }, { timeout: 15000 }))
    await canvas.findByRole("button", { name: "Pull once" })
  }
}
export const Album: Story = {
  name: "首页 → Album → 伙伴图鉴",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Album" }))
    await expect(canvas.getByRole("button", { name: /返回/ })).toBeVisible()
  }
}
export const Equip: Story = {
  name: "首页 → Vibémon → 选择伙伴",
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = () => canvasElement.querySelector<HTMLButtonElement>('button.absolute[aria-label="Vibémon"]')
    await waitFor(() => expect(trigger()).toBeVisible(), { timeout: 15000 })
    await userEvent.click(trigger()!)
    await canvas.findByText("小森", {}, { timeout: 15000 })
  }
}
export const Draw: Story = {
  name: "卡池 → 单次抽取 → 结果",
  args: { petCase: "pull" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull once" }))
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull())
    document.querySelectorAll("video").forEach((video) => video.dispatchEvent(new Event("ended")))
    await canvas.findAllByRole("img", { name: /小森/ }, { timeout: 10000 })
  }
}
export const DrawMulti: Story = {
  name: "卡池 → 多次抽取 → 结果",
  args: { petCase: "pull" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull ten times" }))
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull())
    document.querySelectorAll("video").forEach((video) => video.dispatchEvent(new Event("ended")))
    await canvas.findAllByRole("img", { name: /小森/ }, { timeout: 10000 })
  }
}
