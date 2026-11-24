import type { ComponentProps } from "react"
import { expect } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "login", authenticated: false },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component: "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies SharedMeta<ComponentProps<typeof ProductPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/注册登录/登录状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Password = meta.story({
  name: "密码登录",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
  }
})

export const Register = meta.story({
  name: "注册",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
  }
})

export const InvalidEmail = meta.story({
  name: "邮箱校验",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "not-an-email")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
})

export const CodeSent = meta.story({
  name: "验证码已发送 · 倒计时",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
})

export const Waitlisted = meta.story({
  name: "候补名单",
  args: { authError: "WAITLISTED" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
})

export const Disabled = meta.story({
  name: "账号已停用",
  args: { authError: "DISABLED" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
  }
})

export const Sending = meta.story({ ...CodeSent.input, name: "正在发送验证码", args: { authCase: "sending" } })
export const Network = meta.story({ ...CodeSent.input, name: "验证码发送网络失败", args: { authCase: "network" } })
export const Registered = meta.story({
  name: "注册邮箱已存在",
  args: { authCase: "registered" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
    await expect(await canvas.findByRole("alert")).toBeVisible()
  }
})
export const WrongCode = meta.story({
  name: "验证码错误或已过期",
  args: { authCase: "wrongCode" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "000000")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await canvas.findByRole("alert")
  }
})
export const SigningIn = meta.story({
  ...WrongCode.input,
  name: "验证码登录中",
  args: { authCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await expect(canvas.getByRole("button", { name: /登录$/ })).toBeDisabled()
  }
})
export const WrongPassword = meta.story({
  name: "密码错误",
  args: { authCase: "wrongPassword" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "WrongPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await canvas.findByRole("alert")
  }
})
export const PasswordSigningIn = meta.story({
  ...WrongPassword.input,
  name: "密码登录中",
  args: { authCase: "signingIn" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "密码登录" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "DemoPassword123!")
    await userEvent.click(canvas.getByRole("button", { name: /登录$/ }))
    await expect(canvas.getByRole("button", { name: /登录$/ })).toBeDisabled()
  }
})
export const WeakPassword = meta.story({
  name: "注册密码不符合规则",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "注册" }))
    await userEvent.type(canvas.getByLabelText("邮箱"), "lin.ran@example.test")
    await userEvent.type(canvas.getByLabelText("验证码"), "123456")
    await userEvent.type(canvas.getByLabelText("密码", { exact: true }), "123")
    await userEvent.click(canvas.getByRole("button", { name: /注册/ }))
    await canvas.findByRole("alert")
  }
})
export const Registering = meta.story({
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
})
