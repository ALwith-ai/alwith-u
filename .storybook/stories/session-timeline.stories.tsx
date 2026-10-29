import { acknowledgePrompt, addPrompt, applyUpdate, createSession, type Session } from "@nyssance/codex-acp-v2/client";
import { projectHistoryTurns } from "@nyssance/codex-acp-v2/client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useRef, useState } from "react"
import { expect, spyOn, waitFor } from "storybook/test"

import { Button } from "../../src/components/ui/button"
import { ChatTimeline } from "../fixtures/chat-timeline"

function sentPrompt(previous: Session, text: string, messageId: string): Session {
  const content = [{ type: "text" as const, text }]
  const localId = `local:${messageId}`
  return applyUpdate(acknowledgePrompt(addPrompt(previous, content, localId), localId, messageId), {
    sessionUpdate: "user_message",
    messageId,
    content
  })
}

const output = Array.from({ length: 60 }, (_, index) => `project-file-${index}.ts`).join("\n")
const session = applyUpdate(
  applyUpdate(sentPrompt(createSession("listing-layout", "/storybook/project"), "ls", "prompt"), {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: `\`\`\`text\n${output}\n\`\`\`` },
    _meta: { codex: { phase: "final_answer" } }
  }),
  { sessionUpdate: "state_update", state: "idle" } as never
)

const meta = {
  title: "Chat/Session timeline",
  component: ChatTimeline,
  args: { session },
  decorators: [
    (Story) => (
      <div className="flex h-[480px] min-h-0 flex-col">
        <Story />
      </div>
    )
  ]
} satisfies Meta<typeof ChatTimeline>
export default meta
type Story = StoryObj<typeof meta>

export const DirectoryListing: Story = {
  play: async ({ canvasElement, canvas, userEvent }) => {
    const viewport = canvas.getByRole("log")
    await waitFor(async () => {
      const code = canvasElement.querySelector<HTMLElement>(".codex-markdown-code-block")
      await expect(code).not.toBeNull()
      await expect(code!.getBoundingClientRect().width).toBeGreaterThan(viewport.clientWidth - 60)
      await expect(code!.textContent).toContain("project-file-59.ts")
      await expect(viewport.clientHeight).toBeLessThanOrEqual(480)
      await expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    })
    await waitFor(async () => {
      const last = canvasElement.querySelector<HTMLElement>("[data-codex-turn]")!
      await expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom)
      await expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1)
    })
    const expectFade = async () => {
      await waitFor(async () => {
        const content = viewport.querySelector<HTMLElement>(".codex-timeline-content")!
        const fade = canvasElement.querySelector<HTMLElement>(".codex-timeline-bottom-fade")!
        await expect(getComputedStyle(viewport).maskImage).toBe("none")
        await expect(getComputedStyle(content).maskImage).toBe("none")
        await expect(fade.getBoundingClientRect().height).toBe(24)
        await expect(fade.getBoundingClientRect().bottom).toBe(viewport.getBoundingClientRect().bottom)
        await expect(getComputedStyle(fade).pointerEvents).toBe("none")
      })
    }
    await expectFade()
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -160 }))
    viewport.scrollTop -= 160
    viewport.dispatchEvent(new Event("scroll"))
    await expectFade()
    await userEvent.click(canvas.getByRole("button", { name: "Scroll to bottom" }))
    await waitFor(
      async () =>
        await expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1)
    )
    await expectFade()
    await expect(getComputedStyle(viewport).overscrollBehaviorY).toBe("none")
    const writeScrollTop = spyOn(viewport, "scrollTop", "set")
    try {
      const bottom = viewport.scrollTop
      const last = canvasElement.querySelector<HTMLElement>("[data-codex-turn]")!
      const lastBottom = last.getBoundingClientRect().bottom
      for (let i = 0; i < 6; i++) {
        viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 160 }))
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      }
      await expect(writeScrollTop).not.toHaveBeenCalled()
      await expect(viewport.scrollTop).toBe(bottom)
      await expect(last.getBoundingClientRect().bottom).toBe(lastBottom)
    } finally {
      writeScrollTop.mockRestore()
    }
  }
}

const capacityFailure = {
  sessionUpdate: "agent_message" as const,
  messageId: "codex-error:capacity-turn",
  content: [{ type: "text" as const, text: "Selected model is at capacity. Please try a different model." }],
  _meta: {
    codex: {
      turnId: "capacity-turn",
      error: {
        message: "Selected model is at capacity. Please try a different model.",
        category: "overloaded",
        retryable: true
      }
    }
  }
}
const failedHistory = [
  {
    turnId: "capacity-turn",
    status: "failed",
    itemsView: "full",
    updates: [
      {
        sessionUpdate: "user_message",
        messageId: "capacity-prompt",
        content: [{ type: "text", text: "Inspect the project" }]
      },
      capacityFailure
    ]
  }
]

function ErrorHistoryTimeline() {
  const [current, setCurrent] = useState(() =>
    applyUpdate(
      sentPrompt(createSession("error-history", "/storybook/project"), "Inspect the project", "capacity-prompt"),
      capacityFailure
    )
  )
  return (
    <>
      <ChatTimeline session={current} />
      <div className="flex shrink-0 gap-2 p-2">
        <Button
          onClick={() => setCurrent(projectHistoryTurns("error-history", "/storybook/project", null, failedHistory))}
        >
          Reopen history
        </Button>
        <Button
          onClick={() =>
            setCurrent((previous) =>
              applyUpdate(sentPrompt(previous, "Continue with another task", "next-prompt"), {
                sessionUpdate: "agent_message",
                messageId: "next-answer",
                content: [{ type: "text", text: "The new task is complete." }],
                _meta: { codex: { turnId: "next-turn", phase: "final_answer" } }
              })
            )
          }
        >
          Send next message
        </Button>
      </div>
    </>
  )
}

export const RetainedTurnErrors: Story = {
  render: () => <ErrorHistoryTimeline />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const check = async () => {
      await waitFor(async () => {
        const alerts = canvas.getAllByRole("alert")
        await expect(alerts).toHaveLength(1)
        await expect(alerts[0].textContent).toContain("Selected model is at capacity")
        const spacing = getComputedStyle(alerts[0].parentElement!)
        await expect(spacing.marginTop).toBe("16px")
        await expect(spacing.marginBottom).toBe("16px")
        const viewport = canvas.getByRole("log")
        await expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
      })
    }
    await check()
    await userEvent.click(canvas.getByRole("button", { name: "Reopen history" }))
    await check()
    await userEvent.click(canvas.getByRole("button", { name: "Send next message" }))
    await check()
    await waitFor(async () => {
      const answer = canvas.getByText("The new task is complete.")
      await expect(canvas.getByRole("alert").getBoundingClientRect().top).toBeLessThan(
        answer.getBoundingClientRect().top
      )
      await expect(canvasElement.querySelectorAll(".codex-assistant-message")).toHaveLength(1)
    })
  }
}

function ShortReplyTimeline({ initialSession = session }: { initialSession?: typeof session }) {
  const [current, setCurrent] = useState(initialSession)
  const sequence = useRef(0)
  const send = (complete: boolean) => {
    const index = ++sequence.current
    setCurrent((previous) => {
      const next = sentPrompt(previous, `Short question ${index}`, `short-user-${index}`)
      return complete
        ? applyUpdate(
            applyUpdate(next, {
              sessionUpdate: "agent_message_chunk",
              messageId: `short-answer-${index}`,
              content: { type: "text", text: `Quick answer ${index}` },
              _meta: { codex: { phase: "final_answer" } }
            }),
            { sessionUpdate: "state_update", state: "idle" } as never
          )
        : applyUpdate(next, { sessionUpdate: "state_update", state: "running" } as never)
    })
  }
  return (
    <>
      <ChatTimeline session={current} />
      <div className="flex shrink-0 flex-wrap gap-2 p-2">
        <Button onClick={() => send(false)}>Send message</Button>
        <Button
          onClick={() =>
            setCurrent((previous) =>
              applyUpdate(
                applyUpdate(previous, {
                  sessionUpdate: "agent_message_chunk",
                  messageId: `short-answer-${sequence.current}`,
                  content: { type: "text", text: "A short response." },
                  _meta: { codex: { phase: "final_answer" } }
                }),
                { sessionUpdate: "state_update", state: "idle" } as never
              )
            )
          }
        >
          Finish reply
        </Button>
        <Button onClick={() => send(true)}>Send completed reply</Button>
      </div>
    </>
  )
}

export const ShortRepliesAfterSend: Story = {
  render: () => <ShortReplyTimeline />,
  play: async ({ canvasElement, canvas, userEvent }) => {
    const viewport = canvas.getByRole("log")
    const expectFlow = async () => {
      await waitFor(async () => {
        const turns = [...canvasElement.querySelectorAll<HTMLElement>("[data-codex-turn]")]
        const latest = turns.at(-1)!
        const gap = viewport.getBoundingClientRect().bottom - latest.getBoundingClientRect().bottom
        await expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1)
        await expect(gap).toBeGreaterThanOrEqual(0)
        if (viewport.scrollHeight <= viewport.clientHeight) {
          const top = turns[0].getBoundingClientRect().top - viewport.getBoundingClientRect().top
          await expect(top).toBeGreaterThanOrEqual(0)
          await expect(top).toBeLessThanOrEqual(24)
        } else {
          await expect(gap).toBeLessThanOrEqual(120)
        }
      })
    }
    if (canvasElement.querySelector("[data-codex-turn]") !== null) await expectFlow()
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }))
    await canvas.findByText("Short question 1")
    await expectFlow()
    await userEvent.click(canvas.getByRole("button", { name: "Finish reply" }))
    await canvas.findByText("A short response.")
    await expectFlow()
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 }))
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event("scroll"))
    await userEvent.click(canvas.getByRole("button", { name: "Send completed reply" }))
    await canvas.findByText("Quick answer 2")
    const latest = [...canvasElement.querySelectorAll<HTMLElement>("[data-codex-turn]")].at(-1)!
    await expect(latest).toHaveTextContent("Quick answer 2")
    await expectFlow()
  }
}

export const FirstMessageAfterSend: Story = {
  ...ShortRepliesAfterSend,
  render: () => <ShortReplyTimeline initialSession={createSession("first-message-layout", "/storybook/project")} />
}

const longSession = Array.from({ length: 60 }, (_, index) => index).reduce(
  (previous, index) => {
    const next = sentPrompt(previous, `Question ${index + 1}`, `rapid-user-${index}`)
    return applyUpdate(next, {
      sessionUpdate: "agent_message",
      messageId: `rapid-answer-${index}`,
      content: [
        {
          type: "text",
          text: Array.from({ length: 8 }, () => `Response ${index + 1} with scrollable content.`).join("\n\n")
        }
      ],
      _meta: { codex: { phase: "final_answer" } }
    })
  },
  createSession("rapid-scroll", "/storybook/project")
)

export const RapidScroll: Story = {
  args: { session: longSession },
  play: async ({ canvasElement, canvas }) => {
    const viewport = canvas.getByRole("log")
    await waitFor(async () => expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 10))
    for (const fraction of [0, 0.8, 0.1, 0.95, 0.3, 1]) {
      viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: fraction === 0 ? -10_000 : 10_000 }))
      viewport.scrollTop = fraction * (viewport.scrollHeight - viewport.clientHeight)
      viewport.dispatchEvent(new Event("scroll"))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await expect(getComputedStyle(viewport.querySelector(".codex-timeline-content")!).maskImage).toBe("none")
    }
    await waitFor(async () => {
      const latest = [...canvasElement.querySelectorAll<HTMLElement>("[data-codex-turn]")].at(-1)!
      const gap = viewport.getBoundingClientRect().bottom - latest.getBoundingClientRect().bottom
      await expect(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1)
      await expect(gap).toBeGreaterThanOrEqual(0)
      await expect(gap).toBeLessThanOrEqual(25)
    })
  }
}
