import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, waitFor } from "storybook/test"

import { Button } from "../../src/components/ui/button"
import { AssistantTurn } from "../../src/features/chat/codex/assistant-turn"
import { groupTurns } from "../../src/features/chat/turns"

const paragraphs = Array.from({ length: 24 }, (_, index) => `Checking step ${index + 1} of the long task.`).join("\n\n")

function ReasoningPreview() {
  const [id] = useState(() => crypto.randomUUID())
  const [session, setSession] = useState(() =>
    applyUpdate(
      addPrompt(createSession(id, "/storybook/project"), [{ type: "text", text: "Inspect the project" }], `${id}-user`),
      { sessionUpdate: "agent_thought_chunk", messageId: id, content: { type: "text", text: paragraphs } }
    )
  )
  const [finished, setFinished] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          disabled={finished}
          onClick={() =>
            setSession((current) =>
              applyUpdate(current, {
                sessionUpdate: "agent_thought_chunk",
                messageId: id,
                content: { type: "text", text: "\n\nNewest reasoning update." }
              })
            )
          }
        >
          Append reasoning
        </Button>
        <Button
          disabled={finished}
          onClick={() => {
            setSession((current) =>
              applyUpdate(current, {
                sessionUpdate: "agent_message_chunk",
                messageId: `${id}-commentary`,
                content: { type: "text", text: "Inspection complete; continuing the task." },
                _meta: { codex: { phase: "commentary" } }
              })
            )
            setFinished(true)
          }}
        >
          Finish reasoning
        </Button>
      </div>
      <AssistantTurn
        sessionId={session.id}
        turn={groupTurns(session)[0]}
        terminals={session.terminals}
        active
        isLast
        error={null}
        interrupted={false}
      />
    </div>
  )
}

const meta = {
  title: "Chat/Reasoning",
  component: ReasoningPreview,
  globals: { locale: "en" },
  parameters: {
    a11y: {
      config: {
        // Codex's existing muted reasoning label is below AA contrast; retain all other checks.
        rules: [{ id: "color-contrast", selector: ":not(.codex-reasoning-label)" }]
      }
    }
  }
} satisfies Meta<typeof ReasoningPreview>
export default meta
type Story = StoryObj<typeof meta>

export const LivePreview: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const viewport = () => {
      const element = canvasElement.querySelector<HTMLElement>(".codex-reasoning-details")
      if (element === null) throw new Error("Reasoning preview is missing")
      return element
    }
    await userEvent.click(canvas.getByRole("button", { name: "Thinking" }))
    const maxHeight = 8.75 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    await waitFor(() => {
      void expect(canvas.getByRole("button", { name: "Thinking" })).toHaveAttribute("aria-expanded", "true")
      const preview = viewport()
      void expect(preview.textContent).toContain("Checking step 24")
      void expect(preview.getBoundingClientRect().height).toBeGreaterThan(0)
      void expect(preview.getBoundingClientRect().height).toBeLessThanOrEqual(maxHeight)
      void expect(preview.scrollHeight).toBeGreaterThan(preview.clientHeight)
      void expect(preview.scrollHeight - preview.clientHeight - preview.scrollTop).toBeLessThanOrEqual(1)
    })
    const previousScrollHeight = viewport().scrollHeight
    await userEvent.click(canvas.getByRole("button", { name: "Append reasoning" }))
    await waitFor(() => {
      const preview = viewport()
      void expect(preview.textContent).toContain("Newest reasoning update.")
      void expect(preview.scrollHeight).toBeGreaterThan(previousScrollHeight)
      void expect(preview.getBoundingClientRect().height).toBeLessThanOrEqual(maxHeight)
      void expect(preview.scrollHeight - preview.clientHeight - preview.scrollTop).toBeLessThanOrEqual(1)
    })
    await userEvent.click(canvas.getByRole("button", { name: "Finish reasoning" }))
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "true")
    )
    await userEvent.click(canvas.getByRole("button", { name: "Thought" }))
    await waitFor(() => {
      void expect(canvas.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "false")
      void expect(canvas.queryByRole("button", { name: "Thinking" })).toBeNull()
      void expect(canvas.queryByRole("region", { name: "Thought" })).toBeNull()
      const disclosure = viewport().closest(".codex-activity-details-grid")
      void expect(disclosure?.getBoundingClientRect().height).toBeLessThanOrEqual(1)
    })
    await userEvent.click(canvas.getByRole("button", { name: "Thought" }))
    await waitFor(() => {
      void expect(canvas.getByRole("button", { name: "Thought" })).toHaveAttribute("aria-expanded", "true")
      void expect(viewport().getBoundingClientRect().height).toBeGreaterThan(0)
      void expect(viewport().getBoundingClientRect().height).toBeLessThanOrEqual(maxHeight)
      void expect(viewport().textContent).toContain("Checking step 1")
      void expect(viewport().textContent).toContain("Newest reasoning update.")
    })
    await userEvent.tab()
    void expect(canvas.getByRole("region", { name: "Thought" })).toHaveFocus()
  }
}
