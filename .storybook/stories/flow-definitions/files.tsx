import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { PROJECT_DIRECTORY } from "../../fixtures/catalog"
import { typeInEditor } from "../../fixtures/editor-input"
import { virtualFiles } from "../../fixtures/filesystem"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"

const meta = {
  title: "流程/文件树和预览区/文件与交付",
  component: ProductPreview,
  argTypes: productPreviewArgTypes,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", file: "README.md" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Markdown: Story = {
  name: "聊天 → 打开文件 → 预览与源码切换",
  play: async ({ canvas, userEvent, step }) => {
    await step("查看项目文档", async () => {
      await canvas.findByText("用于管理项目交付、文件和团队协作。")
    })
    await step("切换到源码", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "源码" }))
      await canvas.findByRole("textbox", { name: /Editor content|编辑器内容/ }, { timeout: 15000 })
    })
  }
}
export const SaveText: Story = {
  name: "打开文本 → 编辑 → 保存",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: /Editor content|编辑器内容/ }, { timeout: 15000 })
    await workflowAction("编辑文件", () => typeInEditor(editor, "文件预览已验证"))
    await userEvent.keyboard("{Meta>}s{/Meta}")
    await waitFor(() =>
      expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).toContain("文件预览已验证")
    )
  }
}
export const MultiTabs: Story = {
  name: "项目文件树 → 打开第二文件 → 多标签切换",
  play: async ({ canvas, userEvent }) => {
    await canvas.findByRole("button", { name: "源码" })
    await userEvent.dblClick(await canvas.findByRole("treeitem", { name: /notes.txt/ }))
    await waitFor(() => expect(canvas.getAllByRole("tab").length).toBeGreaterThan(1))
  }
}
export const Maximize: Story = {
  name: "文件预览 → 最大化 → 还原",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "最大化" }))
    await userEvent.click(await canvas.findByRole("button", { name: /还原/ }))
    await canvas.findByRole("button", { name: "最大化" })
  }
}
export const Close: Story = {
  name: "项目文件 → 关闭工作区 → 返回聊天",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "关闭工作区" }))
    await canvas.findByRole("button", { name: "打开预览区" })
  }
}

export const NewFile: Story = {
  name: "文件树 → 新建文件 → 保存到项目",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件" }))
    const dialog = within(await body.findByRole("dialog"))
    const input = dialog.getByRole("textbox")
    await userEvent.clear(input)
    await userEvent.type(input, "review.txt")
    await userEvent.click(dialog.getByRole("button", { name: "确认" }))
    await waitFor(() => expect(virtualFiles.has(`${PROJECT_DIRECTORY}/review.txt`)).toBe(true))
  }
}
export const CancelNewFile: Story = {
  name: "文件树 → 新建文件 → 取消",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件" }))
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "取消" }))
    await expect(virtualFiles.has(`${PROJECT_DIRECTORY}/review.txt`)).toBe(false)
  }
}
export const DirtyCancel: Story = {
  name: "编辑文件 → 关闭 → 取消关闭",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: "Editor content" }, { timeout: 15000 })
    await workflowAction("编辑文件", () => typeInEditor(editor, "待保存的交付记录"))
    await userEvent.click(body.getByRole("tab", { name: /^notes\.txt/ }))
    await userEvent.keyboard("{Delete}")
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "取消" }))
    await body.findByRole("tab", { name: /^notes\.txt/ })
  }
}
export const DirtyDiscard: Story = {
  name: "编辑文件 → 关闭 → 放弃更改",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: "Editor content" }, { timeout: 15000 })
    await workflowAction("编辑文件", () => typeInEditor(editor, "待保存的交付记录"))
    await userEvent.click(body.getByRole("tab", { name: /^notes\.txt/ }))
    await userEvent.keyboard("{Delete}")
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "放弃" }))
    await waitFor(() => expect(body.queryByRole("tab", { name: /^notes\.txt/ })).toBeNull())
    await expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).not.toContain(
      "待保存的交付记录"
    )
  }
}
export const DirtySave: Story = {
  name: "编辑文件 → 关闭 → 保存更改",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: "Editor content" }, { timeout: 15000 })
    await workflowAction("编辑文件", () => typeInEditor(editor, "待保存的交付记录"))
    await userEvent.click(body.getByRole("tab", { name: /^notes\.txt/ }))
    await userEvent.keyboard("{Delete}")
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).toContain("待保存的交付记录")
    )
  }
}
