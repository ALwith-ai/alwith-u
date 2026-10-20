import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"

import { ThreadView } from "../../src/features/chat/thread-view"

const output = Array.from({ length: 60 }, (_, index) => `project-file-${index}.ts`).join("\n")
const session = applyUpdate(
  applyUpdate(
    addPrompt(createSession("listing-layout", "/storybook/project"), [{ type: "text", text: "ls" }], "prompt"),
    {
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: `\`\`\`text\n${output}\n\`\`\`` },
      _meta: { codex: { phase: "final_answer" } }
    }
  ),
  { sessionUpdate: "state_update", state: "idle" } as never
)

const meta = {
  title: "Chat/Thread",
  component: ThreadView,
  args: { session },
  decorators: [
    (Story) => (
      <div className="flex h-[480px] min-h-0 flex-col">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof ThreadView>
export default meta
type Story = StoryObj<typeof meta>

export const DirectoryListing: Story = {
  play: async ({ canvasElement, canvas }) => {
    const viewport = canvas.getByRole("log")
    await waitFor(() => {
      const code = canvasElement.querySelector<HTMLElement>(".codex-markdown-code-block")
      expect(code).not.toBeNull()
      expect(code!.getBoundingClientRect().width).toBeGreaterThan(viewport.clientWidth - 60)
      expect(code!.textContent).toContain("project-file-59.ts")
      expect(viewport.clientHeight).toBeLessThanOrEqual(480)
      expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    })
    await waitFor(() => {
      const last = canvasElement.querySelector<HTMLElement>("[data-codex-turn]")!
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom)
      expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1)
    })
  }
}
