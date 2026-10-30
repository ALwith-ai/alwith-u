import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, waitFor } from "storybook/test"

import { CodexMarkdownRenderer } from "../../../src/features/chat/codex/markdown-renderer"
import { ChatDirectoryContext } from "../../../src/features/chat/file-actions"
import { type WorkspaceActions, WorkspaceContext } from "../../../src/features/workspace/context"
import { openExternal } from "../../fixtures/open"

const meta = {
  id: "页面-聊天-内容排版",
  globals: { locale: "en" },
  title: "页面/主窗聊天/内容排版",
  component: CodexMarkdownRenderer
} satisfies Meta<typeof CodexMarkdownRenderer>
export default meta
type Story = StoryObj<typeof meta>

export const Answer: Story = {
  name: "回复内容",
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
  name: "流式输出",
  args: { text: "Working on **the next step**…\n\n```ts\nconst result =", streaming: true },
  play: async ({ canvas }) => {
    const text = await canvas.findByText("the next step")
    await waitFor(() => expect(text).toBeVisible())
  }
}
export const Chinese: Story = {
  name: "中文内容",
  args: { text: "## 执行结果\n\n已完成 **聊天组件** 的检查。\n\n- 保留原有界面\n- 支持明暗主题" },
  globals: { locale: "zh-CN" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "执行结果" }, { timeout: 15000 })).toBeVisible()
  }
}

export const Arabic: Story = {
  name: "阿拉伯语布局",
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
  name: "文件链接",
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
  name: "网页链接",
  args: { text: "Read the [documentation](https://example.com/docs)." },
  play: async ({ canvas, userEvent }) => {
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("link", { name: "documentation" }))
    await expect(openExternal).toHaveBeenCalledWith("https://example.com/docs")
  }
}
