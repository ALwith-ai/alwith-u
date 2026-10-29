import type { Meta, StoryObj } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import { useState } from "react"
import { expect, userEvent, within } from "storybook/test"

import { CreateWorkBuddy } from "../../src/features/workbuddy/create-workbuddy"

type Request = { parent: string; name: string; productName: string; identifier: string; auth: string }
let submitted: Request | undefined

function CreationFlow() {
  const [result, setResult] = useState<Request>()
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1>创建自己的 ALwith</h1>
        <span className="text-sm text-muted-foreground">交互演示 · 不写入文件</span>
      </header>
      <p>填写应用名称和项目位置，选择是否集成账号，然后创建项目。</p>
      <div className="w-fit">
        <CreateWorkBuddy onCreated={() => setResult(submitted)} />
      </div>
      {result && (
        <section className="flex flex-col gap-4" aria-label="创建结果">
          <p role="status">{result.productName}：模拟创建完成</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt>项目目录</dt>
            <dd>
              {result.parent}/{result.name}
            </dd>
            <dt>应用标识</dt>
            <dd>{result.identifier}</dd>
            <dt>默认能力</dt>
            <dd>
              {result.auth === "alwith"
                ? "聊天、ALwith 登录、账号设置、宠物中心与桌面宠物"
                : "独立使用；模型认证单独设置"}
            </dd>
          </dl>
          <h2>在自己的电脑运行</h2>
          <pre className="overflow-x-auto text-sm">
            <code>{`cd "${result.parent}/${result.name}"\nbun install\nbun run app-config\nbun run dev:tauri`}</code>
          </pre>
          <p className="text-sm text-muted-foreground">
            真实流程会生成项目文件。安装 Bun、Rust 和 Tauri 系统依赖后，运行上面的命令；修改页面源码即可定制自己的应用。
          </p>
          <p className="text-sm">
            编译自己的应用：<code>bun tauri build --bundles app</code>
          </p>
        </section>
      )}
    </main>
  )
}

const meta = {
  title: "WorkBuddy/Create flow",
  component: CreationFlow,
  globals: { locale: "zh-CN" },
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    submitted = undefined
    mockIPC((command, payload) => {
      if (command === "plugin:log|log" || command === "plugin:event|unlisten") return
      if (command === "plugin:event|listen") return 1
      if (command === "plugin:dialog|save") return "/Users/demo/Projects/my-alwith"
      if (command === "workbuddy_create") {
        submitted = payload as Request
        return `${submitted.parent}/${submitted.name}`
      }
      throw new Error(`Unexpected creation preview IPC: ${command}`)
    })
    return () =>
      mockIPC((command) => {
        if (command === "plugin:log|log" || command === "plugin:event|unlisten") return
        throw new Error(`Unexpected Storybook IPC: ${command}`)
      })
  }
} satisfies Meta<typeof CreationFlow>
export default meta
type Story = StoryObj<typeof meta>

async function fill(canvasElement: HTMLElement, bare: boolean) {
  const page = within(canvasElement.ownerDocument.body)
  await userEvent.click(page.getByRole("button", { name: "创建你的 ALwith" }))
  const dialog = within(await page.findByRole("dialog"))
  await userEvent.type(dialog.getByLabelText("应用名称"), bare ? "我的聊天" : "我的工作伙伴")
  await userEvent.type(dialog.getByLabelText("应用标识符"), bare ? "com.example.mychat" : "com.example.mybuddy")
  await userEvent.click(dialog.getByRole("button", { name: "选择新项目路径" }))
  if (bare) await userEvent.click(dialog.getByRole("radio", { name: "不集成 ALwith 账号" }))
  await expect(dialog.getByLabelText("项目位置")).toHaveValue("/Users/demo/Projects/my-alwith")
  return { page, dialog }
}

export const Start: Story = {}
export const WithAccount: Story = {
  name: "带账号与宠物",
  play: async ({ canvasElement }) => {
    await fill(canvasElement, false)
  }
}
export const BareChat: Story = {
  name: "不集成账号",
  play: async ({ canvasElement }) => {
    await fill(canvasElement, true)
  }
}
export const AccountComplete: Story = {
  name: "带账号：完整创建流程",
  play: async ({ canvasElement }) => {
    const { page, dialog } = await fill(canvasElement, false)
    await userEvent.click(dialog.getByRole("button", { name: "创建你的 ALwith" }))
    await expect(await page.findByRole("status")).toHaveTextContent("模拟创建完成")
    await expect(submitted?.auth).toBe("alwith")
  }
}
export const BareComplete: Story = {
  name: "不集成账号：完整创建流程",
  play: async ({ canvasElement }) => {
    const { page, dialog } = await fill(canvasElement, true)
    await userEvent.click(dialog.getByRole("button", { name: "创建你的 ALwith" }))
    await expect(await page.findByRole("status")).toHaveTextContent("模拟创建完成")
    await expect(submitted?.auth).toBe("none")
  }
}
