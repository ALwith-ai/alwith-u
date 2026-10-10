import { ReadableStream, TransformStream, WritableStream } from "node:stream/web"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { CodexClient, type PendingAction } from "@/agent/client"
import { client as applicationClient } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ActionCard } from "../action-card"

// happy-dom's TransformStream lacks getWriter; the in-process ACP peer needs real Web Streams.
globalThis.TransformStream = TransformStream as typeof globalThis.TransformStream
globalThis.ReadableStream = ReadableStream as typeof globalThis.ReadableStream
globalThis.WritableStream = WritableStream as typeof globalThis.WritableStream
await initI18n("en")
const clients: CodexClient[] = []
const mounted: ReturnType<typeof render>[] = []
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount()
    for (const client of clients.splice(0)) client.disconnect()
  })
})

test.each(["Implement this plan?", "Review the implementation plan"])(
  "approval displays the subject title %s only when it differs from the request title",
  subjectTitle => {
    const title = "Implement this plan?"
    const action: PendingAction = {
      id: "plan-approval",
      kind: "permission",
      sessionId: "plan-session",
      params: {
        sessionId: "plan-session",
        title,
        subject: {
          type: "tool_call",
          toolCall: {
            toolCallId: "plan-review",
            title: subjectTitle,
            kind: "switch_mode",
            status: "pending",
            content: [{ type: "content", content: { type: "text", text: "Plan details" } }]
          }
        },
        options: [
          { optionId: "implement", name: "Yes, implement this plan", kind: "allow_once" },
          { optionId: "revise", name: "No, and tell Codex what to do differently", kind: "reject_once" }
        ]
      }
    }
    const onRespond = vi.fn()
    const view = render(<ActionCard action={action} onRespond={onRespond} />)
    mounted.push(view)

    expect(view.getAllByText(title)).toHaveLength(1)
    if (subjectTitle !== title) expect(view.getByText(subjectTitle)).toBeVisible()
    expect(view.getByText("Plan details")).toBeVisible()
    expect(view.getByRole("listbox")).toHaveAccessibleName(title)
    expect(view.getAllByRole("option")).toHaveLength(2)
    fireEvent.click(view.getByRole("option", { name: /Yes, implement this plan/ }))
    expect(onRespond).toHaveBeenCalledWith(action.id, {
      outcome: { outcome: "selected", optionId: "implement" }
    })
  }
)

test("U shared approval answers the exact pending request through the real ACP client", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  const sessionId = await client.newSession("/tmp/approval-test")
  await client.prompt(sessionId, [{ type: "text", text: "permission" }])
  await waitFor(() => expect(client.state.actions.length).toBe(1))
  const action = client.state.actions[0]
  const respond = vi.spyOn(applicationClient, "respond").mockImplementation((id, answer) => client.respond(id, answer))
  try {
    const view = render(<ActionCard action={action} />)
    mounted.push(view)
    const list = view.getByRole("listbox")
    fireEvent.keyDown(list, { key: "1" })
    expect(respond).toHaveBeenCalledWith(action.id, { outcome: { outcome: "selected", optionId: "allow_once" } })
    await waitFor(() => expect(client.state.actions.length).toBe(0))
    await waitFor(() => expect(client.session(sessionId).state).toBe("idle"))
    expect(client.session(sessionId).items.some(item => item.kind === "assistant")).toBe(true)
  } finally {
    respond.mockRestore()
  }
})
