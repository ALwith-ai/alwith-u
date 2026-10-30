import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"

import { typeInEditor } from "../../fixtures/editor-input"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-文件工作区",
  title: "页面/文件树和预览区/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", file: "README.md" },
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

export const Markdown: Story = { name: "Markdown · 预览与编辑" }

export const Delivery: Story = { name: "交付清单", args: { file: "docs/交付清单.md" } }

export const Code: Story = { name: "代码文件", args: { file: "src/dashboard.tsx" } }

export const Json: Story = { name: "JSON 文件", args: { file: "data/projects.json" } }

export const Csv: Story = { name: "表格 CSV", args: { file: "data/tasks.csv" } }

export const Image: Story = { name: "图片 SVG", args: { file: "assets/brand.svg" } }

export const Html: Story = { name: "HTML 预览", args: { file: "preview.html" } }

export const Text: Story = { name: "纯文本", args: { file: "notes.txt" } }

export const Missing: Story = { name: "文件加载失败", args: { file: "missing.md" } }

export const Narrow: Story = { name: "窄窗口工作区", args: { width: 760 } }

export const NewFileDialog: Story = {
  name: "新建文件弹窗",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件" }))
    await body.findByRole("dialog")
  }
}
export const NewFolderDialog: Story = {
  name: "新建文件夹弹窗",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件夹" }))
    await body.findByRole("dialog")
  }
}
export const RenameDialog: Story = {
  name: "文件重命名 · 行内编辑",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "重命名" }))
    await body.findByRole("textbox", { name: "重命名" })
  }
}
export const DeleteDialog: Story = {
  name: "文件删除确认弹窗",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "删除" }))
    await body.findByRole("dialog")
  }
}
export const MoveDialog: Story = {
  name: "移动到 · 选择目标文件夹",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "移动到…" }))
    await body.findByRole("dialog")
  }
}
export const CrossProjectMove: Story = {
  name: "移动到 · 跨项目提示",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "移动到…" }))
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("treeitem", { name: /品牌网站/ }))
    await expect(dialog.getByText(/跨库移动/)).toBeVisible()
  }
}
export const UnsavedDialog: Story = {
  name: "未保存文件 · 保存／放弃／取消",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: "Editor content" }, { timeout: 15000 })
    await typeInEditor(editor, "待保存的交付记录")
    await userEvent.click(body.getByRole("tab", { name: /^notes\.txt/ }))
    await userEvent.keyboard("{Delete}")
    await body.findByRole("dialog")
  }
}
