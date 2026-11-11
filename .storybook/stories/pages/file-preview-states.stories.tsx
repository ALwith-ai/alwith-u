import type { Meta, StoryObj } from "@storybook/react-vite"
import { toast } from "sonner"
import { expect, waitFor, within } from "storybook/test"

import { PROJECT_DIRECTORY } from "../../fixtures/catalog"
import { typeInEditor } from "../../fixtures/editor-input"
import { virtualFiles } from "../../fixtures/filesystem"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"
import { workflowAction } from "../workflow-driver"

const meta = {
  id: "页面-文件工作区-文档媒体与异常",
  title: "页面/文件树和预览区/页面状态",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", binaryFiles: true },
  argTypes: productPreviewArgTypes,
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Pdf: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "PDF · 两页文档",
  args: { file: "samples/sample.pdf" },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('[aria-label="页码 1"] canvas')).toBeVisible(), {
      timeout: 15000
    })
    await waitFor(() => expect(canvasElement.querySelectorAll(".alwith-preview-pdf canvas")).toHaveLength(2))
  }
}
export const Word: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "Word · DOCX 文档",
  args: { file: "samples/sample.docx" },
  play: async ({ canvasElement }) => {
    await waitFor(
      () =>
        expect(canvasElement.querySelector<HTMLIFrameElement>('iframe[title="sample.docx"]')?.srcdoc).toContain(
          "ALwith U document preview"
        ),
      { timeout: 15000 }
    )
  }
}
export const Excel: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览", docs: { description: { story: "桌面应用通过原生解析器解析表格。Storybook 使用浏览器解析样例文件，仅用于展示表格与工作表操作；复杂格式样式可能与桌面不同。" } } },
  name: "Excel · 多工作表",
  args: { file: "samples/sample.xlsx" },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector(".x-spreadsheet")).toBeVisible(), { timeout: 15000 })
    await within(canvasElement).findAllByText("Overview")
  }
}
export const Tiff: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "TIFF 图片",
  args: { file: "samples/sample.tiff" },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector<HTMLImageElement>(".alwith-preview-excel img")?.naturalWidth).toBe(64),
      { timeout: 15000 }
    )
  }
}
export const Audio: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "音频 · WAV 播放器",
  args: { file: "samples/sample.wav" },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("audio[controls]")).toBeVisible(), { timeout: 15000 })
    await waitFor(() => expect(canvasElement.querySelector<HTMLAudioElement>("audio")!.duration).toBeGreaterThan(0))
  }
}
export const Video: Story = {
  parameters: { pageStateGroup: "01 文件预览/01 可以正常预览" },
  name: "视频 · WebM 播放器",
  args: { file: "samples/sample.webm" },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("video[controls]")).toBeVisible(), { timeout: 15000 })
    await waitFor(() => expect(canvasElement.querySelector<HTMLVideoElement>("video")!.videoWidth).toBe(320))
  }
}
export const LegacyWord: Story = {
  parameters: { pageStateGroup: "01 文件预览/02 无法正常预览" },
  name: "旧版 Word · 外部打开提示",
  args: { file: "samples/legacy.doc" },
  play: async ({ canvas }) => {
    await canvas.findByText("旧版 Word 文件需要使用外部应用打开。")
  }
}
export const PowerPoint: Story = {
  name: "PowerPoint · 不支持预览",
  parameters: { pageStateGroup: "01 文件预览/02 无法正常预览" },
  args: { file: "samples/sample.pptx" },
  play: async ({ canvas }) => { await canvas.findByText("此文件没有可用的预览。") }
}
export const CorruptPdf: Story = {
  parameters: { pageStateGroup: "01 文件预览/02 无法正常预览" },
  name: "PDF 损坏 · 解析失败",
  args: { file: "samples/corrupt.pdf" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("alert", {}, { timeout: 15000 })
  }
}
export const ReadError: Story = {
  parameters: { pageStateGroup: "01 文件预览/02 无法正常预览" },
  name: "文件读取失败",
  args: { file: "notes.txt", fileCase: "readError", binaryFiles: false },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByText(/模拟文件操作失败/)
  }
}
export const SaveError: Story = {
  parameters: { pageStateGroup: "02 文件操作/02 异常与恢复" },
  name: "保存失败 · 保留更改",
  args: { file: "notes.txt", fileCase: "saveError", binaryFiles: false },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    const editor = await body.findByRole("textbox", { name: /Editor content|编辑器内容/ }, { timeout: 15000 })
    await workflowAction("修改文本", () => typeInEditor(editor, "保存失败后仍可编辑"))
    await userEvent.keyboard("{Meta>}s{/Meta}")
    await body.findAllByText(/模拟文件操作失败/)
    await expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).not.toContain(
      "保存失败后仍可编辑"
    )
  }
}
export const SaveRetry: Story = {
  ...SaveError,
  name: "再次保存成功 · 未保存标记消失",
  parameters: { pageStateGroup: "02 文件操作/02 异常与恢复", docs: { description: { story: "再次保存成功后，文件标签的未保存标记消失；正式页面没有单独的成功提示。示例在保存成功后清除此前的失败提示。" } } },
  play: async (context) => {
    await SaveError.play!(context)
    await context.userEvent.keyboard("{Meta>}s{/Meta}")
    await waitFor(() =>
      expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).toContain(
        "保存失败后仍可编辑"
      )
    )
    toast.dismiss()
    await waitFor(() => expect(within(context.canvasElement.ownerDocument.body).queryByText(/模拟文件操作失败/)).not.toBeInTheDocument())
  }
}
export const SavePending: Story = {
  parameters: { pageStateGroup: "02 文件操作/02 异常与恢复" },
  name: "保存处理中 · 菜单显示保存中",
  args: { file: "notes.txt", fileCase: "savePending", binaryFiles: false },
  play: async ({ canvasElement, userEvent }) => {
    const editor = await within(canvasElement).findByRole(
      "textbox",
      { name: /Editor content|编辑器内容/ },
      { timeout: 15000 }
    )
    await workflowAction("修改文本", () => typeInEditor(editor, "等待保存完成"))
    await userEvent.keyboard("{Meta>}s{/Meta}")
    await expect(new TextDecoder().decode(virtualFiles.get(`${PROJECT_DIRECTORY}/notes.txt`))).not.toContain(
      "等待保存完成"
    )
    const panel = canvasElement.querySelector<HTMLElement>("#file-workspace-panel")
    if (!panel) throw new Error("File workspace is missing")
    const buttons = within(panel).getAllByRole("button", { name: "更多操作" })
    await userEvent.click(buttons[0]!)
    await expect(await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "保存中…" })).toBeDisabled()
  }
}
export const MoveError: Story = {
  parameters: { pageStateGroup: "02 文件操作/02 异常与恢复" },
  name: "移动失败 · 显示错误",
  args: { file: "notes.txt", fileCase: "moveError", binaryFiles: false },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "移动到…" }))
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.click(dialog.getByRole("treeitem", { name: /品牌网站/ }))
    await userEvent.click(dialog.getByRole("button", { name: /移动/ }))
    await body.findAllByText(/模拟文件操作失败/)
    await expect(virtualFiles.has(`${PROJECT_DIRECTORY}/notes.txt`)).toBe(true)
  }
}
export const DeleteError: Story = {
  parameters: { pageStateGroup: "02 文件操作/02 异常与恢复" },
  name: "删除失败 · 显示错误",
  args: { file: "notes.txt", fileCase: "deleteError", binaryFiles: false },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: await canvas.findByRole("treeitem", { name: /notes.txt/ })
    })
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("menuitem", { name: "删除" }))
    await userEvent.click(within(await body.findByRole("dialog")).getByRole("button", { name: "删除" }))
    await body.findAllByText(/模拟文件操作失败/)
    await expect(virtualFiles.has(`${PROJECT_DIRECTORY}/notes.txt`)).toBe(true)
  }
}
