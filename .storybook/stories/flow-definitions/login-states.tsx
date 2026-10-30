import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/账号与登录/登录状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "login", authenticated: false },
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

export const Password: Story = {
  name: "密码登录",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
  }
}

export const Register: Story = {
  name: "注册",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
  }
}

export const InvalidEmail: Story = {
  name: "邮箱校验",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "not-an-email")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
}

export const CodeSent: Story = {
  name: "验证码已发送 · 倒计时",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
}

export const Waitlisted: Story = {
  name: "候补名单",
  args: { authError: "WAITLISTED" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
}

export const Disabled: Story = {
  name: "账号已停用",
  args: { authError: "DISABLED" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
}

export const Sending: Story = { ...CodeSent, name: "正在发送验证码", args: { authCase: "sending" } }
export const Network: Story = { ...CodeSent, name: "验证码发送网络失败", args: { authCase: "network" } }
export const Registered: Story = {
  name: "注册邮箱已存在",
  args: { authCase: "registered" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
    await expect(await canvas.findByRole("alert")).toBeVisible()
  }
}
export const WrongCode: Story = {
  name: "验证码错误或已过期",
  args: { authCase: "wrongCode" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "000000")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await canvas.findByRole("alert")
  }
}
export const SigningIn: Story = {
  ...WrongCode,
  name: "验证码登录中",
  args: { authCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await expect(canvas.getByRole("button", { name: /登录$/ })).toBeDisabled()
  }
}
export const WrongPassword: Story = {
  name: "密码错误",
  args: { authCase: "wrongPassword" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "WrongPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await canvas.findByRole("alert")
  }
}
export const PasswordSigningIn: Story = {
  ...WrongPassword,
  name: "密码登录中",
  args: { authCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "DemoPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await expect(canvas.getByRole("button", { name: /登录$/ })).toBeDisabled()
  }
}
export const WeakPassword: Story = {
  name: "注册密码不符合规则",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "123")
    await userEvent.click(canvas.getByRole("button", { name: /注册/ }))
    await canvas.findByRole("alert")
  }
}
export const Registering: Story = {
  name: "正在注册",
  args: { authCase: "registering" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "DemoPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /注册/ }))
    await expect(canvas.getByRole("button", { name: /注册/ })).toBeDisabled()
  }
}
