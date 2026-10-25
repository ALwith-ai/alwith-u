import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"

import { CodexMarkdownRenderer } from "../../src/features/chat/codex/markdown-renderer"
import { ChatDirectoryContext } from "../../src/features/chat/file-actions"
import { type WorkspaceActions, WorkspaceContext } from "../../src/features/workspace/context"
import { openExternal } from "../fixtures/open"

const meta = { title: "Chat/Markdown", component: CodexMarkdownRenderer } satisfies Meta<typeof CodexMarkdownRenderer>
export default meta
type Story = StoryObj<typeof meta>

export const Answer: Story = {
  args: {
    text: "## Implementation ready\n\nThe **shared chat renderer** supports lists, code, and tables.\n\n- No agent process\n- No account required\n\n```ts\nconst greeting = 'Hello, ALwith U'\n```\n\n| Check | Result |\n| --- | --- |\n| Typecheck | Passed |"
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Implementation ready" }, { timeout: 10_000 })
    ).toBeVisible()
  }
}

export const Streaming: Story = {
  args: { text: "Working on **the next step**…\n\n```ts\nconst result =", streaming: true },
  play: async ({ canvas }) => {
    const text = await canvas.findByText("the next step")
    await waitFor(() => expect(text).toBeVisible())
  }
}
export const Chinese: Story = {
  args: { text: "## 执行结果\n\n已完成 **聊天组件** 的检查。\n\n- 保留原有界面\n- 支持明暗主题" },
  globals: { locale: "zh-CN" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "执行结果" })).toBeVisible()
  }
}
export const Dark: Story = { ...Answer, globals: { theme: "dark" } }

export const Arabic: Story = {
  args: { text: "## نتيجة التنفيذ\n\nتم فحص **المحادثة**.\n\n```ts\nconst greeting = 'Hello, ALwith U'\n```" },
  globals: { locale: "ar" },
  play: async ({ canvas, canvasElement }) => {
    const heading = await canvas.findByRole("heading", { name: "نتيجة التنفيذ" })
    await waitFor(() => expect(getComputedStyle(heading).direction).toBe("rtl"))
    const code = canvasElement.querySelector("pre")
    await expect(code).not.toBeNull()
    await expect(getComputedStyle(code!).direction).toBe("ltr")
  }
}

const workspace = {
  visible: true,
  toggle: fn(),
  openFile: fn<WorkspaceActions["openFile"]>().mockResolvedValue(undefined),
  openProject: fn<WorkspaceActions["openProject"]>().mockResolvedValue(undefined),
  revealEntry: fn<WorkspaceActions["revealEntry"]>().mockResolvedValue(undefined)
} satisfies WorkspaceActions

export const FileLink: Story = {
  args: { text: "Review [greeting.ts](/storybook/project/src/greeting.ts:1)." },
  decorators: [
    (Story) => (
      <WorkspaceContext value={workspace}>
        <ChatDirectoryContext value="/storybook/project">
          <Story />
        </ChatDirectoryContext>
      </WorkspaceContext>
    )
  ],
  play: async ({ canvas, userEvent }) => {
    workspace.openFile.mockClear()
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("link", { name: "greeting.ts" }))
    await expect(workspace.openFile).toHaveBeenCalledWith("/storybook/project/src/greeting.ts", "/storybook/project", {
      lineNumber: 1,
      column: 1
    })
    await expect(openExternal).not.toHaveBeenCalled()
  }
}

export const WebLink: Story = {
  args: { text: "Read the [documentation](https://example.com/docs)." },
  play: async ({ canvas, userEvent }) => {
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("link", { name: "documentation" }))
    await expect(openExternal).toHaveBeenCalledWith("https://example.com/docs")
  }
}
