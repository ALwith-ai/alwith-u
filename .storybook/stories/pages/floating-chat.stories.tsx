import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "页面/浮窗聊天/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "guide" },
  decorators: [
    (Story) => (
      <div className="flex h-dvh w-full items-center justify-center p-4">
        <div className="h-[min(640px,calc(100dvh-32px))] w-[min(600px,calc(100vw-32px))] [&>div]:!h-full [&>div>main]:!h-full">
          <Story />
        </div>
      </div>
    )
  ],
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

export const FloatingDraft: Story = {
  name: "浮动聊天 · 新建",
  args: { page: "floating", chatCase: "welcome" }
}

export const FloatingConversation: Story = {
  name: "浮动聊天 · 对话",
  args: { page: "floating", chatCase: "conversation" }
}

export const FloatingPermission: Story = {
  name: "浮动聊天 · 待确认",
  args: { page: "floating", chatCase: "permission" }
}
