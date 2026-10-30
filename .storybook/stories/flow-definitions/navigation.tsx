import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/主窗整体/导航与辅助窗口",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "conversation" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Modules: Story = {
  name: "聊天 → 插件 → 扩展 → Vibémon → 返回聊天",
  play: async ({ canvas, userEvent, step }) => {
    for (const name of ["插件", "扩展", "Vibémon"])
      await step(name, async () => {
        await userEvent.click(canvas.getAllByRole("button", { name })[0]!)
        await expect(canvas.getAllByRole("button", { name }).length).toBeGreaterThan(1)
      })
    await userEvent.click(canvas.getByRole("button", { name: "返回主屏" }))
    await canvas.findByRole("button", { name: "打开聊天浮窗" })
  }
}
export const Palette: Story = {
  name: "搜索入口 → 查找聊天 → 打开会话",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole("button", { name: "搜索聊天…" }))
    await userEvent.type(await body.findByRole("combobox"), "交付")
    await body.findAllByRole("option")
  }
}
export const NoMatch: Story = {
  name: "搜索入口 → 无匹配 → 退出",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole("button", { name: "搜索聊天…" }))
    await userEvent.type(await body.findByRole("combobox"), "no-such-project-937")
    await userEvent.keyboard("{Escape}")
  }
}
export const Account: Story = {
  name: "用户菜单 → 设置 → 账户资料",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole("button", { name: /^林然/ }))
    await userEvent.click(await body.findByRole("menuitem", { name: /设置/ }))
    await body.findByRole("button", { name: "账户" })
  }
}
export const Guide: Story = {
  name: "帮助 → 使用指南 → 切换章节",
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole("button", { name: "帮助" }))
    await userEvent.click(await body.findByRole("menuitem", { name: "用户指南" }))
    const chapters = await body.findByRole("navigation", { name: "Guide chapters" })
    await userEvent.click(within(chapters).getAllByRole("button")[1]!)
    await expect(within(chapters).getAllByRole("button")[1]!).toHaveAttribute("aria-current", "page")
  }
}
