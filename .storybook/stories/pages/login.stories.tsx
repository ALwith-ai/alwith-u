import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent } from "storybook/test"

import { configureAuthScenario, usePlatformAuth } from "../../fixtures/auth"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-账号与登录",
  title: "页面/注册登录/页面状态",
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
          "使用真实产品组件和独立的内存模拟数据。重新选择示例即可重置页面状态。"
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

type LoginMode = "code" | "password" | "register"
type Scenario = {
  mode: LoginMode
  stage?: "email" | "send" | "filled" | "submit"
  email?: string
  code?: string
  password?: string
  invalidField?: "邮箱" | "验证码" | "密码"
  error?: boolean
  pending?: boolean
  success?: boolean
}

function scenario(options: Scenario): Story["play"] {
  return async ({ canvas, userEvent, args }) => {
    // Sending a code is a successful prerequisite for submission scenarios.
    configureAuthScenario("ready", null)
    if (options.mode !== "code")
      await userEvent.click(canvas.getByRole("tab", { name: options.mode === "password" ? "密码登录" : "注册" }))
    const email = options.email ?? "lin.ran@example.test"
    if (email) void fireEvent.change(canvas.getByLabelText("邮箱"), { target: { value: email } })
    if (options.stage === "email") return
    if (options.stage === "send") {
      configureAuthScenario(args.authCase, args.authError)
      await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
      if (options.error) await expect(await canvas.findByRole("alert")).toBeVisible()
      else if (options.pending) await expect(canvas.getByRole("button", { name: "发送验证码" })).toBeDisabled()
      else await expect(await canvas.findByRole("button", { name: /秒后重发/ })).toBeDisabled()
      return
    }
    if (options.mode !== "password" && email.includes("@")) {
      await userEvent.click(canvas.getByRole("button", { name: "发送验证码" }))
      await canvas.findByRole("button", { name: /秒后重发/ })
    }
    const code = options.code ?? "123456"
    const password = options.password ?? "DemoPassword123!"
    if (options.mode !== "password" && code)
      void fireEvent.change(canvas.getByLabelText("验证码"), { target: { value: code } })
    if (options.mode !== "code" && password)
      void fireEvent.change(canvas.getByLabelText("密码", { exact: true }), { target: { value: password } })
    if (options.stage === "filled") return
    configureAuthScenario(args.authCase, args.authError)
    const submit = canvas.getByRole("button", { name: options.mode === "register" ? /^注册$/ : /^登录$/ })
    await userEvent.click(submit)
    if (options.invalidField) {
      const input = canvas.getByLabelText(options.invalidField, { exact: true }) as HTMLInputElement
      await expect(input.checkValidity()).toBe(false)
      await expect(usePlatformAuth.getState().isAuthenticated).toBe(false)
    } else if (options.error) await expect(await canvas.findByRole("alert")).toBeVisible()
    else if (options.pending) await expect(submit).toBeDisabled()
    else if (options.success) {
      await expect(canvas.queryByRole("tab", { name: "验证码登录" })).not.toBeInTheDocument()
      await expect(usePlatformAuth.getState().isAuthenticated).toBe(true)
    }
  }
}

export const Loading: Story = {
  name: "01 读取本机登录信息",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  args: { authCase: "loading" }
}

export const Code: Story = {
  name: "02 打开验证码登录",
  parameters: { pageStateGroup: "验证码登录/正常主流程" }
}

export const CodeEmail: Story = {
  name: "03 填写邮箱",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  play: scenario({ mode: "code", stage: "email" })
}

export const Sending: Story = {
  name: "04 正在发送验证码",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  args: { authCase: "sending" },
  play: scenario({ mode: "code", stage: "send", pending: true })
}

export const CodeSent: Story = {
  name: "05 验证码已发送 · 60 秒重发冷却",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  play: scenario({ mode: "code", stage: "send" })
}

export const CodeFilled: Story = {
  name: "06 填写验证码 · 待登录",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  play: scenario({ mode: "code", stage: "filled" })
}

export const SigningIn: Story = {
  name: "07 正在登录",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  args: { authCase: "signingIn" },
  play: scenario({ mode: "code", stage: "submit", pending: true })
}

export const CodeSuccess: Story = {
  name: "08 登录成功 · 进入主窗",
  parameters: { pageStateGroup: "验证码登录/正常主流程" },
  play: scenario({ mode: "code", stage: "submit", success: true })
}

export const CodeMissingEmail: Story = {
  name: "09 异常 · 邮箱未填写",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  play: scenario({ mode: "code", stage: "submit", email: "", invalidField: "邮箱" })
}

export const CodeInvalidEmailSubmit: Story = {
  name: "10 异常 · 提交时邮箱格式错误",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  play: scenario({ mode: "code", stage: "submit", email: "not-an-email", invalidField: "邮箱" })
}

export const CodeMissingCode: Story = {
  name: "11 异常 · 验证码未填写",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  play: scenario({ mode: "code", stage: "submit", code: "", invalidField: "验证码" })
}

export const CodeMissingEmailSend: Story = {
  name: "12 异常 · 发送时邮箱未填写",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  play: scenario({ mode: "code", stage: "send", email: "", error: true })
}

export const InvalidEmail: Story = {
  name: "13 异常 · 发送时邮箱格式错误",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  play: scenario({ mode: "code", stage: "send", email: "not-an-email", error: true })
}

export const Network: Story = {
  name: "14 异常 · 发送验证码 · 网络连接失败",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authCase: "network" },
  play: scenario({ mode: "code", stage: "send", error: true })
}

export const Waitlisted: Story = {
  name: "15 异常 · 发送验证码 · 候补名单",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "WAITLISTED" },
  play: scenario({ mode: "code", stage: "send", error: true })
}

export const Disabled: Story = {
  name: "16 异常 · 发送验证码 · 账号已停用",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "DISABLED" },
  play: scenario({ mode: "code", stage: "send", error: true })
}

export const CodeSendServiceFailure: Story = {
  name: "17 异常 · 发送验证码 · 服务返回错误",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "服务暂时不可用，请稍后重试。" },
  play: scenario({ mode: "code", stage: "send", error: true })
}

export const WrongCode: Story = {
  name: "18 异常 · 验证码错误或已过期",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authCase: "wrongCode" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitNetwork: Story = {
  name: "19 异常 · 登录 · 网络连接失败",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authCase: "network" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitWaitlisted: Story = {
  name: "20 异常 · 登录 · 候补名单",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "WAITLISTED" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitDisabled: Story = {
  name: "21 异常 · 登录 · 账号已停用",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "DISABLED" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitServiceFailure: Story = {
  name: "22 异常 · 登录 · 服务返回错误",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authError: "服务暂时不可用，请稍后重试。" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitEmptyFailure: Story = {
  name: "23 异常 · 登录 · 服务未返回错误说明",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authCase: "emptyFailure" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const CodeSubmitSessionFailure: Story = {
  name: "24 异常 · 登录 · 保存登录状态失败",
  parameters: { pageStateGroup: "验证码登录/异常流程" },
  args: { authCase: "sessionFailure" },
  play: scenario({ mode: "code", stage: "submit", error: true })
}

export const Password: Story = {
  name: "01 打开密码登录",
  parameters: { pageStateGroup: "密码登录/正常主流程" },
  play: scenario({ mode: "password", stage: "email", email: "" })
}

export const PasswordEmail: Story = {
  name: "02 填写邮箱",
  parameters: { pageStateGroup: "密码登录/正常主流程" },
  play: scenario({ mode: "password", stage: "email" })
}

export const PasswordFilled: Story = {
  name: "03 填写密码 · 待登录",
  parameters: { pageStateGroup: "密码登录/正常主流程" },
  play: scenario({ mode: "password", stage: "filled" })
}

export const PasswordSigningIn: Story = {
  name: "04 正在登录",
  parameters: { pageStateGroup: "密码登录/正常主流程" },
  args: { authCase: "signingIn" },
  play: scenario({ mode: "password", stage: "submit", pending: true })
}

export const PasswordSuccess: Story = {
  name: "05 登录成功 · 进入主窗",
  parameters: { pageStateGroup: "密码登录/正常主流程" },
  play: scenario({ mode: "password", stage: "submit", success: true })
}

export const PasswordMissingEmail: Story = {
  name: "06 异常 · 邮箱未填写",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  play: scenario({ mode: "password", stage: "submit", email: "", invalidField: "邮箱" })
}

export const PasswordInvalidEmailSubmit: Story = {
  name: "07 异常 · 提交时邮箱格式错误",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  play: scenario({ mode: "password", stage: "submit", email: "not-an-email", invalidField: "邮箱" })
}

export const PasswordMissingPassword: Story = {
  name: "08 异常 · 密码未填写",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  play: scenario({ mode: "password", stage: "submit", password: "", invalidField: "密码" })
}

export const WrongPassword: Story = {
  name: "09 异常 · 邮箱或密码错误",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authCase: "wrongPassword" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitNetwork: Story = {
  name: "10 异常 · 登录 · 网络连接失败",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authCase: "network" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitWaitlisted: Story = {
  name: "11 异常 · 登录 · 候补名单",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authError: "WAITLISTED" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitDisabled: Story = {
  name: "12 异常 · 登录 · 账号已停用",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authError: "DISABLED" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitServiceFailure: Story = {
  name: "13 异常 · 登录 · 服务返回错误",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authError: "服务暂时不可用，请稍后重试。" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitEmptyFailure: Story = {
  name: "14 异常 · 登录 · 服务未返回错误说明",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authCase: "emptyFailure" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const PasswordSubmitSessionFailure: Story = {
  name: "15 异常 · 登录 · 保存登录状态失败",
  parameters: { pageStateGroup: "密码登录/异常流程" },
  args: { authCase: "sessionFailure" },
  play: scenario({ mode: "password", stage: "submit", error: true })
}

export const Register: Story = {
  name: "01 打开注册",
  parameters: { pageStateGroup: "注册/正常主流程" },
  play: scenario({ mode: "register", stage: "email", email: "" })
}

export const RegisterEmail: Story = {
  name: "02 填写邮箱",
  parameters: { pageStateGroup: "注册/正常主流程" },
  play: scenario({ mode: "register", stage: "email" })
}

export const RegisterCheckingEmail: Story = {
  name: "03 检查邮箱是否已注册",
  parameters: { pageStateGroup: "注册/正常主流程" },
  args: { authCase: "checkingEmail" },
  play: scenario({ mode: "register", stage: "send", pending: true })
}

export const RegisterSending: Story = {
  name: "04 正在发送验证码",
  parameters: { pageStateGroup: "注册/正常主流程" },
  args: { authCase: "sending" },
  play: scenario({ mode: "register", stage: "send", pending: true })
}

export const RegisterCodeSent: Story = {
  name: "05 验证码已发送 · 60 秒重发冷却",
  parameters: { pageStateGroup: "注册/正常主流程" },
  play: scenario({ mode: "register", stage: "send" })
}

export const RegisterFilled: Story = {
  name: "06 填写验证码和密码 · 待注册",
  parameters: { pageStateGroup: "注册/正常主流程" },
  play: scenario({ mode: "register", stage: "filled" })
}

export const Registering: Story = {
  name: "07 正在注册",
  parameters: { pageStateGroup: "注册/正常主流程" },
  args: { authCase: "registering" },
  play: scenario({ mode: "register", stage: "submit", pending: true })
}

export const RegisterSuccess: Story = {
  name: "08 注册成功 · 进入主窗",
  parameters: { pageStateGroup: "注册/正常主流程" },
  play: scenario({ mode: "register", stage: "submit", success: true })
}

export const RegisterMissingEmail: Story = {
  name: "09 异常 · 邮箱未填写",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "submit", email: "", invalidField: "邮箱" })
}

export const RegisterInvalidEmailSubmit: Story = {
  name: "10 异常 · 提交时邮箱格式错误",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "submit", email: "not-an-email", invalidField: "邮箱" })
}

export const RegisterMissingCode: Story = {
  name: "11 异常 · 验证码未填写",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "submit", code: "", invalidField: "验证码" })
}

export const RegisterMissingPassword: Story = {
  name: "12 异常 · 密码未填写",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "submit", password: "", invalidField: "密码" })
}

export const WeakPassword: Story = {
  name: "13 异常 · 密码不符合规则",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "submit", password: "123", error: true })
}

export const RegisterMissingEmailSend: Story = {
  name: "14 异常 · 发送时邮箱未填写",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "send", email: "", error: true })
}

export const RegisterInvalidEmailSend: Story = {
  name: "15 异常 · 发送时邮箱格式错误",
  parameters: { pageStateGroup: "注册/异常流程" },
  play: scenario({ mode: "register", stage: "send", email: "not-an-email", error: true })
}

export const Registered: Story = {
  name: "16 异常 · 邮箱已注册",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "registered" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterEmailCheckNetwork: Story = {
  name: "17 异常 · 检查邮箱失败",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "emailCheckNetwork" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterSendNetwork: Story = {
  name: "18 异常 · 发送验证码 · 网络连接失败",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "network" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterSendWaitlisted: Story = {
  name: "19 异常 · 发送验证码 · 候补名单",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "WAITLISTED" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterSendDisabled: Story = {
  name: "20 异常 · 发送验证码 · 账号已停用",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "DISABLED" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterSendServiceFailure: Story = {
  name: "21 异常 · 发送验证码 · 服务返回错误",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "服务暂时不可用，请稍后重试。" },
  play: scenario({ mode: "register", stage: "send", error: true })
}

export const RegisterWrongCode: Story = {
  name: "22 异常 · 验证码错误或已过期",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "wrongCode" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitNetwork: Story = {
  name: "23 异常 · 注册 · 网络连接失败",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "network" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitWaitlisted: Story = {
  name: "24 异常 · 注册 · 候补名单",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "WAITLISTED" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitDisabled: Story = {
  name: "25 异常 · 注册 · 账号已停用",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "DISABLED" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitServiceFailure: Story = {
  name: "26 异常 · 注册 · 服务返回错误",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authError: "服务暂时不可用，请稍后重试。" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitEmptyFailure: Story = {
  name: "27 异常 · 注册 · 服务未返回错误说明",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "emptyFailure" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}

export const RegisterSubmitSessionFailure: Story = {
  name: "28 异常 · 注册 · 保存登录状态失败",
  parameters: { pageStateGroup: "注册/异常流程" },
  args: { authCase: "sessionFailure" },
  play: scenario({ mode: "register", stage: "submit", error: true })
}
