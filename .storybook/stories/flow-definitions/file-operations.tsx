import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { PROJECT_DIRECTORY } from "../../fixtures/catalog"
import { typeInEditor } from "../../fixtures/editor-input"
import { fileRequest, virtualFiles } from "../../fixtures/filesystem"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"

const meta = {
  title: "流程/文件树和预览区/文件操作与恢复",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", file: "README.md" },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const NewFolder: Story = {
  name: "新建文件夹 → 输入名称 → 完成",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "新建文件夹" }))
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.clear(dialog.getByRole("textbox"))
    await userEvent.type(dialog.getByRole("textbox"), "reviews")
    await userEvent.click(dialog.getByRole("button", { name: "确认" }))
    await waitFor(() =>
      expect(
        fileRequest({ operation: "stat", root: PROJECT_DIRECTORY, path: `${PROJECT_DIRECTORY}/reviews` })
      ).toMatchObject({ kind: "directory" })
    )
  }
}
export const Rename: Story = {
  name: "文件重命名 → 编辑名称 → 保存",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "重命名" }))
    const input = await body.findByRole("textbox", { name: "重命名" })
    await userEvent.clear(input)
    await userEvent.type(input, "review.txt{Enter}")
    await waitFor(() => expect(virtualFiles.has(`${PROJECT_DIRECTORY}/review.txt`)).toBe(true))
    await expect(virtualFiles.has(`${PROJECT_DIRECTORY}/notes.txt`)).toBe(false)
  }
}
export const Delete: Story = {
  name: "删除文件 → 确认 → 列表更新",
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "删除" }))
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "删除" }))
    await waitFor(() => expect(virtualFiles.has(`${PROJECT_DIRECTORY}/notes.txt`)).toBe(false))
  }
}
export const SaveRetry: Story = {
  name: "修改文件 → 保存失败 → 再次保存成功",
  args: { file: "notes.txt", fileCase: "saveError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const editor = await canvas.findByRole("textbox", { name: /Editor content|编辑器内容/ }, { timeout: 15000 })
    await workflowAction("修改项目文本", () => typeInEditor(editor, "重试后保存的交付记录"))
    await userEvent.keyboard("{Meta>}s{/Meta}")
    await within(canvasElement.ownerDocument.body).findByText(/模拟文件操作失败/)
    await expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).not.toContain(
      "重试后保存的交付记录"
    )
    await userEvent.keyboard("{Meta>}s{/Meta}")
    await waitFor(() =>
      expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).toContain(
        "重试后保存的交付记录"
      )
    )
  }
}
