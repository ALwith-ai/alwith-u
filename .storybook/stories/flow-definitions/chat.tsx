import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { actionsTaken, client, restoreConnection } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/主窗聊天/聊天与项目",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "project" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Send: Story = {
  name: "项目 → 发送 → 思考 → 完成 → 继续对话",
  play: async ({ canvasElement, userEvent, step }) => {
    const body = within(canvasElement.ownerDocument.body)
    const input = () => canvasElement.querySelector<HTMLElement>('textarea[placeholder="发送消息"]')!
    await step("输入项目任务", async () => {
      await waitFor(() => expect(input()).toBeVisible())
      await userEvent.click(input())
      await userEvent.type(input(), "请整理今天的交付清单")
      await userEvent.click(body.getByRole("button", { name: "发送" }))
    })
    await step("等待回复并继续", async () => {
      await body.findByText(/检查已完成，交付清单已更新/)
      await userEvent.click(input())
      await userEvent.type(input(), "请补充文件预览的验证记录")
      await userEvent.click(body.getByRole("button", { name: "发送" }))
      await waitFor(() => expect(actionsTaken.filter((action) => action.type === "prompt")).toHaveLength(2))
      await waitFor(() => expect(body.getAllByText(/检查已完成，交付清单已更新/)).toHaveLength(2))
    })
  }
}
export const QuickChat: Story = { ...Send, name: "随聊 → 发送 → 完成", args: { chatCase: "welcome" } }
export const Stop: Story = {
  name: "生成中 → 停止",
  args: { chatCase: "running" },
  play: async ({ canvas, userEvent, step }) => {
    await step("停止当前生成", async () => {
      await userEvent.click(await canvas.findByRole("button", { name: "停止" }))
      await waitFor(() => expect(client.session("running").state).toBe("idle"))
    })
  }
}
export const Reconnect: Story = {
  name: "连接失败 → 重连 → 新聊天",
  args: { connection: "failed" },
  play: async ({ canvas, userEvent }) => {
    const reconnect = await canvas.findByRole("button", { name: "重新连接" })
    restoreConnection()
    await userEvent.click(reconnect)
    await waitFor(() => expect(client.state.connection).toBe("ready"))
  }
}
export const SendError: Story = {
  ...Send,
  name: "发送 → 模型繁忙",
  args: { response: "error" },
  play: async ({ canvasElement, userEvent }) => {
    const input = () => canvasElement.querySelector<HTMLElement>('textarea[placeholder="发送消息"]')!
    await waitFor(() => expect(input()).toBeVisible())
    await userEvent.type(input()!, "检查项目页面")
    await userEvent.click(within(canvasElement).getByRole("button", { name: "发送" }))
    await within(canvasElement).findByText(/模型当前繁忙/)
  }
}
export const Model: Story = {
  name: "新聊天 → 切换模型与推理强度",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: /6.1-Sol/ }))
    await userEvent.click(await body.findByRole("menuitemradio", { name: /6-Astra/ }))
    await waitFor(() => expect(body.getByRole("button", { name: /6-Astra/ })).toBeVisible())
    await userEvent.click(body.getByRole("button", { name: /6-Astra/ }))
    const effort = await body.findByRole("slider", { name: "Effort" })
    effort.focus()
    await userEvent.keyboard("{ArrowRight}")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(body.getByRole("button", { name: /6-Astra/ })).toHaveTextContent("高"))
  }
}
export const SwitchProject: Story = {
  name: "项目聊天 → 选择项目 → 新建项目聊天",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const buttons = await body.findAllByRole("button", { name: "产品工作台" })
    await userEvent.click(buttons.at(-1)!)
    await body.findByRole("menu")
    await userEvent.click(await body.findByRole("menuitemradio", { name: "品牌网站" }))
    const input = await body.findByRole("textbox", { name: "发送消息" })
    await userEvent.type(input, "整理品牌网站的交付清单")
    await userEvent.click(body.getByRole("button", { name: "发送" }))
    await body.findByText(/检查已完成，交付清单已更新/)
    await waitFor(() =>
      expect(
        Object.values(client.state.sessions).some(
          (session) => session.title === "整理品牌网站的交付清单" && session.cwd.endsWith("品牌网站")
        )
      ).toBe(true)
    )
  }
}
export const Rename: Story = {
  name: "已有聊天 → 重命名 → 更新标题",
  args: { chatCase: "conversation" },
  play: async ({ canvasElement, userEvent, step }) => {
    const body = within(canvasElement.ownerDocument.body)
    await step("打开重命名", async () => {
      await userEvent.click(body.getByRole("button", { name: "更多操作" }))
      await userEvent.click(await body.findByRole("menuitem", { name: /重命名/ }))
    })
    await step("保存标题", async () => {
      const dialog = within(await body.findByRole("dialog"))
      const field = dialog.getByRole("textbox")
      await userEvent.clear(field)
      await userEvent.type(field, "产品交付复核")
      await userEvent.click(dialog.getByRole("button", { name: "重命名" }))
      await waitFor(() => expect(client.session("conversation").title).toBe("产品交付复核"))
    })
  }
}
export const SearchChat: Story = {
  name: "已有聊天 → 搜索内容 → 定位结果",
  args: { chatCase: "long" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByRole("log")
    await userEvent.click(body.getByRole("button", { name: "更多操作" }))
    await userEvent.click(await body.findByRole("menuitem", { name: /查找/ }))
    const search = await body.findByPlaceholderText("在聊天中查找")
    await userEvent.type(search, "模块 12")
    await expect(search).toHaveValue("模块 12")
  }
}
export const Floating: Story = {
  name: "主窗口 → 浮动聊天 → 返回主窗口",
  args: { chatCase: "conversation" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(body.getByRole("button", { name: "打开聊天浮窗" }))
    await waitFor(() => expect(canvasElement.querySelector("main.rounded-2xl")).toBeVisible())
    await userEvent.click(body.getByRole("button", { name: "更多操作" }))
    await userEvent.click(await body.findByRole("menuitem", { name: /回到聊天主窗/ }))
    await body.findByRole("button", { name: "打开聊天浮窗" })
  }
}

export const ConfigureProvider: Story = {
  name: "缺少模型登录 → 配置模型提供方",
  args: { draftFailure: "请先登录模型账号或配置供应商。" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "配置服务商" }))
    await body.findByRole("region", { name: "大模型" })
  }
}
export const TransferDraft: Story = {
  name: "未发送草稿 → 浮动聊天 → 返回并保留输入",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const input = await body.findByRole("textbox", { name: "发送消息" })
    await userEvent.type(input, "尚未发送的项目任务")
    await userEvent.click(body.getByRole("button", { name: "打开聊天浮窗" }))
    await waitFor(() => expect(body.getByRole("textbox", { name: "发送消息" })).toHaveValue("尚未发送的项目任务"))
    await userEvent.click(body.getByRole("button", { name: "更多操作" }))
    await userEvent.click(await body.findByRole("menuitem", { name: /回到聊天主窗/ }))
    await waitFor(() => expect(body.getByRole("textbox", { name: "发送消息" })).toHaveValue("尚未发送的项目任务"))
  }
}
