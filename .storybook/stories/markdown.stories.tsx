import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { CodexMarkdownRenderer } from "../../src/features/chat/codex/markdown-renderer"
import { openExternal } from "../fixtures/open"

const meta = { title: "Chat/Markdown", component: CodexMarkdownRenderer } satisfies Meta<typeof CodexMarkdownRenderer>
export default meta
type Story = StoryObj<typeof meta>

export const Answer: Story = {
  args: {
    text: "## Implementation ready\n\nThe **shared chat renderer** supports lists, code, and tables.\n\n- No agent process\n- No account required\n\n```ts\nconst greeting = 'Hello, ALwith U'\n```\n\n| Check | Result |\n| --- | --- |\n| Typecheck | Passed |"
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Implementation ready" })).toBeVisible()
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

export const FileLink: Story = {
  args: { text: "Review [greeting.ts](/storybook/project/src/greeting.ts:1)." },
  play: async ({ canvas, userEvent }) => {
    openExternal.mockClear()
    await userEvent.click(await canvas.findByRole("link", { name: "greeting.ts" }))
    await expect(openExternal).toHaveBeenCalledWith("/storybook/project/src/greeting.ts:1")
  }
}
