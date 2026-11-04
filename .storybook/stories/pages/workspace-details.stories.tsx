import { CommentSurface, type DriveContentHost, DriveContentProvider } from "@alwith/module-drive/content"
import { desktopDefaults } from "@nyssance/atlas/layout"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { type ReactNode, useState } from "react"
import { expect, waitFor } from "storybook/test"

import { Button } from "@/components/ui/button"

import { ChatHeader } from "../../../src/features/chat/chat-header"
import { PreviewSurface } from "../../../src/features/workspace/preview-surface"
import { WorkspacePanels } from "../../../src/features/workspace/workspace-panels"

const commentHost: DriveContentHost = {
  transport: {
    request: async (request) => {
      if (request.type === "commentContext")
        return { type: "commentContext", data: { fileId: 1, currentUserId: 1, isOwner: true } }
      if (request.type === "comments") return { type: "comments", data: [] }
      if (request.type === "commentWatch") return { type: "done" }
      throw new Error(`Unexpected comment request: ${request.type}`)
    },
    subscribe: async () => () => {}
  },
  userName: "Reviewer",
  language: "en",
  pushConnected: true,
  translate: (key) => key,
  onError: (error) => {
    throw error
  },
  saveDocument: async () => {},
  collaborationOwner: () => {},
  notify: {
    error: (message) => {
      throw new Error(message)
    },
    success: () => {}
  },
  searchUsers: async () => [],
  controls: {
    Button: ({ variant: _variant, size: _size, ...props }) => <button {...props} />,
    Input: (props) => <input {...props} />,
    Textarea: (props) => <textarea {...props} />,
    Checkbox: ({ checked, onCheckedChange }) => (
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
    )
  }
}

function WorkspaceExample({ width = 1200, comments = false }: { width?: number; comments?: boolean }): ReactNode {
  const [visible, setVisible] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [treeVisible, setTreeVisible] = useState(true)
  return (
    <div className="flex h-[700px] flex-col bg-sidebar p-1 text-foreground" style={{ width }}>
      <Button onClick={() => setVisible(true)}>Open preview</Button>
      <WorkspacePanels
        visible={visible}
        maximized={maximized}
        onVisibleChange={setVisible}
        onMaximizedChange={setMaximized}
        chat={
          <>
            <ChatHeader title="New chat">{null}</ChatHeader>
            <label className="p-4">
              Message
              <input aria-label="Message" className="border" />
            </label>
          </>
        }
        preview={
          <PreviewSurface
            treeVisible={treeVisible}
            onTreeVisibleChange={setTreeVisible}
            maximized={maximized}
            onMaximize={() => setMaximized((value) => !value)}
            onClose={() => {
              setVisible(false)
              setMaximized(false)
            }}
            tree={
              <div className="h-full">
                <Button onClick={() => setTreeVisible(false)}>Hide tree</Button>
                <p className="p-4">Project / notes.md</p>
              </div>
            }
            editor={({ leading, trailing }) => {
              const editor = (
                <div className="alwith-editor">
                  <div className="alwith-workspace-tabbar">
                    {leading}
                    <div className="alwith-workspace-tab-scroll">notes.md</div>
                    {trailing}
                  </div>
                  <label className="p-4">
                    Document
                    <textarea aria-label="Document" defaultValue="Retained draft" />
                  </label>
                </div>
              )
              return comments ? (
                <DriveContentProvider host={commentHost}>
                  <CommentSurface path="/drive/notes.md">{editor}</CommentSurface>
                </DriveContentProvider>
              ) : (
                editor
              )
            }}
          />
        }
      />
    </div>
  )
}

const meta = {
  id: "页面-文件工作区-布局细节",
  tags: ["layout"],
  globals: { locale: "en" },
  title: "页面/文件树和预览区/布局细节",
  component: WorkspaceExample,
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof WorkspaceExample>
export default meta
type Story = StoryObj<typeof meta>

export const EqualPanels: Story = {
  name: "等宽面板",
  play: async ({ canvasElement, canvas, userEvent }) => {
    // Atlas owns the gaps: a docked region's edge is the shell gutter plus its half-gap; the maximized
    // preview spans the regions' half-gaps and keeps only the shell gutter.
    const edges = desktopDefaults.gutter * 4
    const maximizedEdges = desktopDefaults.gutter * 2
    const layout = canvasElement.querySelector<HTMLElement>(".file-workspace-layout")!
    const chat = canvasElement.querySelector<HTMLElement>(".file-workspace-chat")!
    const preview = canvasElement.querySelector<HTMLElement>(".file-workspace-panel")!
    await waitFor(async () => {
      const left = chat.getBoundingClientRect(),
        right = preview.getBoundingClientRect()
      await expect(left.width).toBeCloseTo(right.width, 0)
      await expect(right.left - left.right).toBe(8)
      await expect(getComputedStyle(chat).borderRadius).toBe("0px")
    })
    await userEvent.type(canvas.getByRole("textbox", { name: "Message" }), "Keep this message")
    await userEvent.click(canvas.getByRole("button", { name: "Maximize" }))
    await waitFor(async () => {
      await expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth - maximizedEdges)
      await expect(chat.closest(".file-workspace-slide")).toHaveAttribute("inert")
    })
    await userEvent.click(canvas.getByRole("button", { name: "Restore" }))
    await waitFor(
      async () => await expect(chat.getBoundingClientRect().width).toBeCloseTo(preview.getBoundingClientRect().width, 0)
    )
    await expect(canvas.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this message")
    await userEvent.click(canvas.getByRole("button", { name: "Hide tree" }))
    await userEvent.click(canvas.getByRole("button", { name: "Show file tree" }))
    await waitFor(
      async () =>
        await expect(canvasElement.querySelector(".file-workspace-tree")).toHaveAttribute("data-collapsed", "false")
    )
    await userEvent.click(canvas.getByRole("button", { name: "Close preview" }))
    await waitFor(async () => expect(chat.getBoundingClientRect().width).toBe(layout.clientWidth - edges))
    await userEvent.click(canvas.getByRole("button", { name: "Open preview" }))
    await waitFor(
      async () => await expect(preview.getBoundingClientRect().width).toBeCloseTo(chat.getBoundingClientRect().width, 0)
    )
    await expect(canvas.getByRole("textbox", { name: "Document" })).toHaveValue("Retained draft")
  }
}

export const NarrowPanels: Story = {
  name: "窄窗口面板",
  args: { width: 650 },
  play: async ({ canvasElement, canvas }) => {
    const viewport = canvasElement.querySelector<HTMLElement>(".file-workspace-layout")!
    const slides = canvasElement.querySelectorAll<HTMLElement>(".file-workspace-slide")
    await waitFor(async () => {
      await expect(slides[0].getBoundingClientRect().width).toBe(viewport.clientWidth)
      await expect(slides[1].getBoundingClientRect().width).toBe(viewport.clientWidth)
      await expect(canvas.getByRole("button", { name: "Next pane" })).toBeInTheDocument()
      await expect(canvas.queryByRole("button", { name: "Previous pane" })).toBeNull()
    })
  }
}

export const ResizeBoundaries: Story = {
  name: "面板尺寸边界",
  play: async ({ canvasElement, canvas, userEvent }) => {
    const layout = canvasElement.querySelector<HTMLElement>(".file-workspace-layout")!
    const divider = canvas.getByRole("separator", { name: "Resize workspace" })
    const preview = canvasElement.querySelector<HTMLElement>(".file-workspace-preview-slide")!
    await userEvent.click(divider)
    await userEvent.keyboard("{ArrowLeft}")
    await waitFor(async () => expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth / 2 + 20))
    for (let index = 0; index < 11; index++) await userEvent.keyboard("{ArrowRight}")
    await waitFor(async () => {
      await expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth)
      await expect(layout).toHaveAttribute("data-open", "true")
    })
    await userEvent.keyboard("{ArrowLeft}")
    await waitFor(async () => expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth / 2 - 180))
    await userEvent.click(canvas.getByRole("separator", { name: "Resize workspace" }))
    for (let index = 0; index < 28; index++) await userEvent.keyboard("{ArrowLeft}")
    await waitFor(async () => {
      await expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth)
      await expect(
        canvasElement.querySelector<HTMLElement>(".file-workspace-slide")!.getBoundingClientRect().width
      ).toBe(0)
    })
  }
}

export const WindowResize: Story = {
  name: "调整窗口大小",
  play: async ({ canvasElement, canvas, userEvent }) => {
    const layout = canvasElement.querySelector<HTMLElement>(".file-workspace-layout")!
    const frame = layout.parentElement!
    const preview = canvasElement.querySelector<HTMLElement>(".file-workspace-preview-slide")!
    await waitFor(async () => expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth / 2))
    frame.style.width = "1400px"
    await waitFor(async () => expect(preview.getBoundingClientRect().width).toBe(layout.clientWidth / 2))
    await userEvent.click(canvas.getByRole("separator", { name: "Resize workspace" }))
    await userEvent.keyboard("{ArrowLeft}")
    const draggedWidth = layout.clientWidth / 2 + 20
    await waitFor(async () => expect(preview.getBoundingClientRect().width).toBe(draggedWidth))
    frame.style.width = "1600px"
    await waitFor(async () => {
      await expect(preview.getBoundingClientRect().width).toBe(draggedWidth)
      await expect(
        canvasElement.querySelector<HTMLElement>(".file-workspace-slide")!.getBoundingClientRect().width
      ).toBe(layout.clientWidth - draggedWidth)
    })
  }
}

export const CommentDrawerOverlay: Story = {
  name: "评论收起占位，展开覆盖",
  args: { comments: true },
  play: async ({ canvasElement, canvas, userEvent }) => {
    const editor = canvasElement.querySelector<HTMLElement>(".alwith-editor")!
    const pane = canvasElement.querySelector<HTMLElement>(".file-workspace-editor")!
    const assertSeparate = async (sidebar: HTMLElement): Promise<void> => {
      const document = editor.getBoundingClientRect()
      const comments = sidebar.getBoundingClientRect()
      const bounds = pane.getBoundingClientRect()
      await expect(document.width).toBeGreaterThan(0)
      await expect(document.right).toBeLessThanOrEqual(comments.left)
      await expect(comments.right).toBeLessThanOrEqual(bounds.right)
      await expect(comments.top).toBe(bounds.top)
      await expect(comments.height).toBe(bounds.height)
    }
    const assertOverlay = async (drawer: HTMLElement): Promise<void> => {
      const document = editor.getBoundingClientRect()
      const comments = drawer.getBoundingClientRect()
      const bounds = pane.getBoundingClientRect()
      await expect(getComputedStyle(drawer).position).toBe("absolute")
      await expect(comments.left).toBeLessThan(document.right)
      await expect(comments.right).toBe(bounds.right)
      await expect(comments.top).toBe(bounds.top)
      await expect(comments.height).toBe(bounds.height)
    }
    const rail = await canvas.findByTestId("comment-rail")
    await waitFor(() => assertSeparate(rail))
    const collapsedWidth = editor.getBoundingClientRect().width
    await userEvent.click(rail)
    const drawer = await canvas.findByTestId("comment-drawer")
    await waitFor(() => assertOverlay(drawer))
    await expect(editor.getBoundingClientRect().width).toBe(collapsedWidth)
    canvasElement.querySelector<HTMLElement>(".file-workspace-layout")!.parentElement!.style.width = "650px"
    await waitFor(() => assertOverlay(drawer))
    await userEvent.click(canvas.getByRole("button", { name: "drive.comments.collapse" }))
    await waitFor(() => assertSeparate(canvas.getByTestId("comment-rail")))
    await userEvent.click(canvas.getByRole("button", { name: "Hide tree" }))
    await waitFor(() => assertSeparate(canvas.getByTestId("comment-rail")))
  }
}
