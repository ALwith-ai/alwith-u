import type { ComponentProps } from "react"
import { expect, within } from "storybook/test"

import { typeInEditor } from "../../fixtures/editor-input"
import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", file: "README.md" },
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
  id: "页面-文件工作区",
  title: "页面/文件树和预览区/页面状态",
  excludeStories: ["pageMeta"],
  component: ProductPreview,
  ...pageMeta
})

export const Markdown = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "Markdown · 预览与编辑"
})

export const Code = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "代码文件",
  args: { file: "src/dashboard.tsx" }
})

export const Json = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "JSON 文件",
  args: { file: "data/projects.json" }
})

export const Csv = meta.story({
  parameters: {
    pageStateGroup: "01 文件预览/01 可以正常预览",
    docs: { description: { story: "桌面应用使用原生表格解析器；Storybook 使用浏览器解析样例内容。" } }
  },
  name: "表格 CSV",
  args: { file: "data/tasks.csv" }
})

export const Image = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "图片 SVG",
  args: { file: "assets/brand.svg" }
})

export const Html = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "HTML 预览",
  args: { file: "preview.html" }
})

export const Text = meta.story({
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "纯文本",
  args: { file: "notes.txt" }
})

export const Missing = meta.story({
  parameters: { pageStateGroup: "01 文件预览/02 无法正常预览" },
  name: "文件加载失败",
  args: { file: "missing.md" }
})

export const FolderContextMenu = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "文件夹右键菜单",
  play: async ({ canvas, canvasElement, userEvent }) => {
    const target = await canvas.findByRole("treeitem", { name: /assets/ })
    const rect = target.getBoundingClientRect()
    await userEvent.pointer({
      keys: "[MouseRight]",
      target,
      coords: { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    })
    await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "在这个文件夹里对话" })
  }
})
export const FileContextMenu = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "文件右键菜单",
  play: async ({ canvas, canvasElement, userEvent }) => {
    const target = await canvas.findByRole("treeitem", { name: /notes.txt/ })
    const rect = target.getBoundingClientRect()
    await userEvent.pointer({
      keys: "[MouseRight]",
      target,
      coords: { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
    })
    await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "重命名" })
  }
})
export const ExcelSwitch = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "Excel · 切换工作表",
  args: { file: "samples/sample.xlsx", binaryFiles: true },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.click(await within(canvasElement).findByText("Details", { selector: "li" }, { timeout: 15000 }))
    await expect(within(canvasElement).getByText("Details", { selector: "li" })).toBeVisible()
  }
})
export const NewFileDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "新建文件弹窗",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件" }))
    await body.findByRole("dialog")
  }
})
export const NewFolderDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "新建文件夹弹窗",
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "新建文件夹" }))
    await body.findByRole("dialog")
  }
})
export const RenameDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
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
})
export const DeleteDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
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
})
export const MoveDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
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
})
export const CrossProjectMove = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
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
})
export const UnsavedDialog = meta.story({
  parameters: { pageStateGroup: "02 文件操作/01 常用操作" },
  name: "未保存文件 · 保存／放弃／取消",
  args: { file: "notes.txt" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: "Editor content" }, { timeout: 15000 })
    typeInEditor(editor, "待保存的交付记录")
    await userEvent.click(body.getByRole("tab", { name: /^notes\.txt/ }))
    await userEvent.keyboard("{Delete}")
    await body.findByRole("dialog")
  }
})
