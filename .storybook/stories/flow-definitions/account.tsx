import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { usePlatformAuth } from "../../fixtures/auth"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/账号与登录",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "login" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Code: Story = {
  name: "邮箱 → 获取验证码 → 登录 → 主界面",
  play: async ({ canvas, userEvent, step }) => {
    await step("获取验证码", async () => {
      await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
      await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
      await canvas.findByRole("button", { name: /秒/ })
    })
    await step("登录", async () => {
      await userEvent.type(canvas.getByLabelText("验证码"), "123456")
      await userEvent.click(canvas.getByRole("button", { name: "登录" }))
      await waitFor(() => expect(usePlatformAuth.getState().isAuthenticated).toBe(true))
      await canvas.findByRole("button", { name: "新聊天" })
    })
  }
}
export const Password: Story = {
  name: "密码登录 → 主界面",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("密码"), "DemoPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: "登录" }))
    await waitFor(() => expect(usePlatformAuth.getState().isAuthenticated).toBe(true))
  }
}
export const Register: Story = {
  name: "注册 → 验证邮箱 → 创建账号",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.type(canvas.getByLabelText("密码"), "DemoPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /注册/ }))
    await waitFor(() => expect(usePlatformAuth.getState().isAuthenticated).toBe(true))
  }
}
export const InvalidEmail: Story = {
  name: "输入无效邮箱 → 显示校验 → 修正",
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText("邮箱")
    await userEvent.type(field, "invalid")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
    await canvas.findByRole("alert")
    await userEvent.clear(field)
    await userEvent.type(field, "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
    await canvas.findByRole("button", { name: /秒/ })
  }
}
export const Waitlisted: Story = {
  name: "验证码登录 → 等待开通",
  args: { authError: "WAITLISTED" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.click(canvas.getByRole("button", { name: "登录" }))
    await canvas.findByRole("alert")
  }
}
export const Disabled: Story = { ...Waitlisted, name: "验证码登录 → 账号禁用", args: { authError: "DISABLED" } }
export const Logout: Story = {
  name: "设置 → 账户 → 退出登录",
  args: { page: "settings", settingsSection: "account" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: /退出 ALwith/ }))
    await waitFor(() => expect(usePlatformAuth.getState().isAuthenticated).toBe(false))
  }
}
