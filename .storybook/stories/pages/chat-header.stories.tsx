import { initialCollectionData } from "@alwith/module-collection"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fireEvent, within } from "storybook/test"

import { dispatchCollection, useCollectionStore } from "../../../src/features/collection/store"
import { settingsStore } from "../../../src/lib/settings-store"
import { makeSession } from "../../fixtures/catalog"
import { client } from "../../fixtures/client"
import { preparePreview } from "../../fixtures/prepare"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-主窗聊天-顶部操作",
  title: "页面/主窗聊天/顶部操作",
  component: ProductPreview,
  loaders: [async (context) => {
    await preparePreview(context)
    const data = initialCollectionData()
    const snapshot = await settingsStore.read()
    await settingsStore.write({ action: "update", expectedRevision: snapshot.revision, changes: { "collections.data": { collections: data.collections, order: data.order } } })
    useCollectionStore.setState(data, true)
    return {}
  }],
  args: { page: "chat", chatCase: "conversation" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

const openMore: NonNullable<Story["play"]> = async ({ canvasElement, userEvent }) => {
  const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
  if (!header) throw new Error("Chat header is missing")
  await userEvent.click(await within(header).findByRole("button", { name: "更多操作" }))
}

const openProject: NonNullable<Story["play"]> = async ({ canvasElement, userEvent }) => {
  const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
  if (!header) throw new Error("Chat header is missing")
  await userEvent.click(await within(header).findByRole("button", { name: "产品工作台" }))
  await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
}
export const Project: Story = {
  name: "项目与聊天列表", parameters: { pageStateGroup: "01 项目与标题" }, play: openProject
}
export const ProjectMore: Story = {
  name: "项目聊天 · 展开更多", parameters: { pageStateGroup: "01 项目与标题" },
  play: async (context) => {
    await openProject(context)
    const popup = await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
    await context.userEvent.click(await within(popup).findByRole("button", { name: "显示更多" }))
  }
}
export const ProjectSwitch: Story = {
  name: "项目聊天 · 切换已有聊天", parameters: { pageStateGroup: "01 项目与标题" },
  play: async (context) => {
    const session = { ...makeSession("conversation", "thread-5"), title: "修复文件预览与编辑状态" }
    client.store.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }))
    await openProject(context)
    const popup = await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
    await context.userEvent.click(await within(popup).findByRole("button", { name: "修复文件预览与编辑状态" }))
    const header = context.canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await within(header).findByText("修复文件预览与编辑状态")
  }
}
export const ProjectFolder: Story = {
  name: "项目路径 · 打开项目", parameters: { pageStateGroup: "01 项目与标题" },
  play: async (context) => {
    await openProject(context)
    const popup = await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
    await context.userEvent.hover(await within(popup).findByRole("button", { name: "打开项目文件夹" }))
  }
}
export const ProjectNewChat: Story = {
  name: "项目中新建聊天", parameters: { pageStateGroup: "01 项目与标题" },
  play: async (context) => {
    await openProject(context)
    const popup = await within(context.canvasElement.ownerDocument.body).findByRole("dialog", { name: "产品工作台" })
    await context.userEvent.click(await within(popup).findByRole("button", { name: "新聊天" }))
    const header = context.canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await within(header).findByText("新聊天")
  }
}
export const Favorite: Story = {
  name: "收藏与选择集合", parameters: { pageStateGroup: "02 收藏" },
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await dispatchCollection({ type: "create", id: "header-work", name: "工作资料" })
    await userEvent.hover(await within(header).findByRole("button", { name: "收藏" }))
    await within(canvasElement.ownerDocument.body).findByRole("menuitemradio")
  }
}
export const Favorited: Story = {
  name: "已收藏聊天", parameters: { pageStateGroup: "02 收藏" },
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.click(await within(header).findByRole("button", { name: "收藏" }))
    await within(header).findByRole("button", { name: "从所有集合移除" })
  }
}
export const FavoriteSelected: Story = {
  name: "已收藏 · 查看所属集合与移除", parameters: { pageStateGroup: "02 收藏" },
  play: async ({ canvasElement, userEvent }) => {
    await dispatchCollection({ type: "create", id: "header-work", name: "工作资料" })
    await dispatchCollection({ type: "add", collectionId: "header-work", sessionId: "conversation" })
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.hover(await within(header).findByRole("button", { name: "从所有集合移除" }))
    await within(canvasElement.ownerDocument.body).findByRole("menuitemradio", { name: "工作资料" })
  }
}
export const FavoriteCreate: Story = {
  name: "收藏 · 创建集合", parameters: { pageStateGroup: "02 收藏" },
  play: async ({ canvasElement, userEvent }) => {
    const header = canvasElement.querySelector<HTMLElement>("[data-main-chat-header]")
    if (!header) throw new Error("Chat header is missing")
    await userEvent.hover(await within(header).findByRole("button", { name: "收藏" }))
    const body = within(canvasElement.ownerDocument.body)
    void fireEvent.click(await body.findByRole("menuitem", { name: "创建集合" }))
    const input = await body.findByRole("textbox", { name: "集合名称" })
    await body.findByRole("button", { name: "确认" })
    input.focus()
  }
}
export const More: Story = { name: "更多操作菜单", parameters: { pageStateGroup: "03 更多操作" }, play: openMore }
export const Rename: Story = {
  name: "重命名聊天", parameters: { pageStateGroup: "03 更多操作" },
  play: async (context) => {
    await openMore(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await context.userEvent.click(await body.findByRole("menuitem", { name: "重命名" }))
    await body.findByRole("dialog")
  }
}
export const Search: Story = {
  name: "在聊天中查找", parameters: { pageStateGroup: "03 更多操作" },
  play: async (context) => {
    await openMore(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await context.userEvent.click(await body.findByRole("menuitem", { name: /在聊天中查找/ }))
    await context.canvas.findByPlaceholderText("在聊天中查找")
  }
}
export const OpenProject: Story = {
  name: "选择打开项目的应用", parameters: { pageStateGroup: "03 更多操作" },
  play: async (context) => {
    await openMore(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await context.userEvent.hover(await body.findByRole("menuitem", { name: "打开" }))
    await body.findByText("Visual Studio Code")
  }
}
export const Delete: Story = {
  name: "删除聊天 · 确认", parameters: { pageStateGroup: "03 更多操作" },
  play: async (context) => {
    await openMore(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await context.userEvent.click(await body.findByRole("menuitem", { name: "删除" }))
    await body.findByRole("dialog")
  }
}
