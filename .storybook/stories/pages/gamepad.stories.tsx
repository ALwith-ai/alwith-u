import type { Meta, StoryObj } from "@storybook/react-vite"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "页面/Gamepad/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "guide" },
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

export const Gamepad: Story = {
  parameters: { __id: "页面-辅助窗口--gamepad" },
  name: "手柄设置 · 未连接",
  args: { page: "gamepad" }
}

export const GamepadConnected: Story = {
  parameters: { __id: "页面-辅助窗口--gamepad-connected" },
  name: "手柄设置 · 已连接",
  args: { page: "gamepad", gamepadCase: "connected" }
}
export const GamepadRunning: Story = {
  parameters: { __id: "页面-辅助窗口--gamepad-running" },
  name: "手柄设置 · 运行中",
  args: { page: "gamepad", gamepadCase: "running" }
}
export const GamepadError: Story = {
  parameters: { __id: "页面-辅助窗口--gamepad-error" },
  name: "手柄设置 · 引擎错误",
  args: { page: "gamepad", gamepadCase: "error" }
}
