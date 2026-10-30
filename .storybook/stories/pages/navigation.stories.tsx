import type { Meta, StoryObj } from "@storybook/react-vite"
import { within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-导航与项目",
  title: "页面/主窗整体/导航与项目/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project" },
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

export const Projects: Story = { name: "项目分组与最近聊天" }

export const Activity: Story = { name: "活动 · 生成、待确认、完成", args: { sidebarView: "activity" } }

export const EmptyActivity: Story = { name: "活动 · 空", args: { sidebarView: "activity", emptyThreads: true } }

export const Drive: Story = { name: "云盘项目", args: { sidebarView: "drive" } }

export const PersonalAccount: Story = { name: "个人账号导航", args: { companyAccount: false } }

export const Palette: Story = { name: "搜索与命令", args: { paletteOpen: true } }

export const PaletteEmpty: Story = {
  name: "搜索 · 无匹配",
  args: { paletteOpen: true },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByRole("combobox"), "no-such-project-937")
  }
}

export const Hotkeys: Story = { name: "快捷键", args: { hotkeysOpen: true } }

export const AccountMenu: Story = {
  name: "用户菜单",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /^林然/ }))
  }
}

export const ProjectPicker: Story = {
  name: "选择项目",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const buttons = body.getAllByRole("button", { name: /^产品工作台$/ })
    await userEvent.click(buttons.at(-1)!)
  }
}
