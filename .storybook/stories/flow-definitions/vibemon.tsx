import type { ComponentProps } from "react"
import { expect, waitFor } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
export const pageMeta = {
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "vibemon" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/负一屏/宠物",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})
export const Wish = meta.story({
  name: "首页 → Wish → 卡池",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Wish" }, { timeout: 15000 }))
    await canvas.findByRole("button", { name: "Pull once" })
  }
})
export const Album = meta.story({
  name: "首页 → Album → 伙伴图鉴",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Album" }))
    await expect(canvas.getByRole("button", { name: /返回/ })).toBeVisible()
  }
})
export const Equip = meta.story({
  name: "首页 → Vibémon → 选择伙伴",
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = () => canvasElement.querySelector<HTMLButtonElement>('button.absolute[aria-label="Vibémon"]')
    await waitFor(() => expect(trigger()).toBeVisible(), { timeout: 15000 })
    await userEvent.click(trigger()!)
    await canvas.findByText("小森", {}, { timeout: 15000 })
  }
})
export const Draw = meta.story({
  name: "卡池 → 单次抽取 → 结果",
  args: { vibemonCase: "pull" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull once" }))
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull())
    document.querySelectorAll("video").forEach((video) => video.dispatchEvent(new Event("ended")))
    await canvas.findAllByRole("img", { name: /小森/ }, { timeout: 10000 })
  }
})
export const DrawMulti = meta.story({
  name: "卡池 → 多次抽取 → 结果",
  args: { vibemonCase: "pull" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Pull ten times" }))
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull())
    document.querySelectorAll("video").forEach((video) => video.dispatchEvent(new Event("ended")))
    await canvas.findAllByRole("img", { name: /小森/ }, { timeout: 10000 })
  }
})
