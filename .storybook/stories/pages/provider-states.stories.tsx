import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
const meta = {
  id: "页面-设置-供应商配置",
  title: "页面/设置页/供应商配置",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "settings", settingsSection: "provider" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const CustomNew: Story = {
  name: "新增自定义供应商",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "自定义" }))
  }
}
export const CustomEdit: Story = {
  name: "编辑已有自定义供应商",
  args: { providerCase: "custom" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "团队模型网关" }))
  }
}
export const JsonEditor: Story = {
  ...CustomEdit,
  name: "编辑模型列表 JSON",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "团队模型网关" }))
    await userEvent.click(canvas.getByRole("button", { name: "编辑 JSON" }))
  }
}
export const JsonInvalid: Story = {
  ...JsonEditor,
  name: "模型 JSON 格式错误",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "团队模型网关" }))
    await userEvent.click(canvas.getByRole("button", { name: "编辑 JSON" }))
    const input = canvas.getAllByLabelText("模型列表（JSON）").find((input) => !input.closest("[hidden]"))!
    await userEvent.clear(input)
    await userEvent.type(input, "invalid-json")
    await userEvent.click(canvas.getByRole("button", { name: "预览模型" }))
    await canvas.findByRole("alert")
  }
}
export const JsonDuplicate: Story = {
  ...JsonEditor,
  name: "模型 ID 重复",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "团队模型网关" }))
    await userEvent.click(canvas.getByRole("button", { name: "编辑 JSON" }))
    const input = canvas.getAllByLabelText("模型列表（JSON）").find((input) => !input.closest("[hidden]"))!
    await userEvent.clear(input)
    await userEvent.paste('[{"label":"模型一","api_id":"same"},{"label":"模型二","api_id":"same"}]')
    await userEvent.click(canvas.getByRole("button", { name: "预览模型" }))
    await canvas.findByRole("alert")
  }
}
export const Pending: Story = { name: "配置等待对话结束后生效", args: { providerCase: "pending" } }
export const ApplyError: Story = { name: "配置应用失败", args: { providerCase: "error" } }
export const TestSuccess: Story = {
  name: "连接测试成功",
  args: { providerCase: "pending" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "测试连接" }))
    await canvas.findByRole("status")
  }
}
export const InvalidKey: Story = { ...TestSuccess, name: "API 密钥无效", args: { providerCase: "invalidKey" } }
export const Timeout: Story = { ...TestSuccess, name: "连接超时", args: { providerCase: "timeout" } }
export const Network: Story = { ...TestSuccess, name: "网络连接失败", args: { providerCase: "network" } }
export const RateLimited: Story = { ...TestSuccess, name: "请求限流或余额不足", args: { providerCase: "rateLimited" } }
export const Unsupported: Story = { ...TestSuccess, name: "接口返回格式无效", args: { providerCase: "unsupported" } }
export const Testing: Story = {
  ...TestSuccess,
  name: "连接测试中",
  args: { providerCase: "testing" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "测试连接" }))
    await expect(canvas.getByRole("button", { name: "测试连接" })).toBeDisabled()
  }
}
export const Saving: Story = {
  name: "密钥保存中",
  args: { providerCase: "saving" },
  play: async ({ canvas, userEvent }) => {
    const key = (await canvas.findAllByLabelText("API 密钥")).find((input) => !input.closest("[hidden]"))!
    await userEvent.type(key, "demo-key")
    await userEvent.click(canvas.getByRole("button", { name: /保存$/ }))
    await expect(canvas.getByRole("button", { name: /保存$/ })).toBeDisabled()
  }
}
