import { ReadableStream, TransformStream, WritableStream } from "node:stream/web"

import { CodexClient, type PendingAction } from "@alwith/module-chat/client"
import { PermissionModeMenu } from "@alwith/module-chat/conversation"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"
import { ThemeProvider } from "@/components/theme-provider"
import { client as applicationClient } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ActionCard } from "../action-card"
import { ChatTimelineHost } from "./timeline-host"

// happy-dom's TransformStream lacks getWriter; the in-process ACP peer needs real Web Streams.
vi.stubGlobal("TransformStream", TransformStream)
vi.stubGlobal("ReadableStream", ReadableStream)
vi.stubGlobal("WritableStream", WritableStream)
await initI18n("en")
const clients: CodexClient[] = []
const mounted: ReturnType<typeof render>[] = []
afterEach(async () => {
  await act(() => {
    return Promise.try(() => {
      for (const view of mounted.splice(0)) view.unmount()
      for (const client of clients.splice(0)) client.disconnect()
    })
  })
})

test("full access marks the current permission trigger as destructive", () => {
  const view = render(
    <ChatTimelineHost>
      <PermissionModeMenu
        sessionId="s"
        disabled={false}
        options={[
          {
            configId: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "agent-full-access",
            options: [{ value: "agent-full-access", name: "Full access" }]
          }
        ]}
      />
    </ChatTimelineHost>
  )
  mounted.push(view)
  expect(view.getByRole("button", { name: /Full access/ })).toHaveAttribute("data-permission-warning")
})

test.each(["Implement this plan?", "Review the implementation plan"])(
  "approval displays the subject title %s only when it differs from the request title",
  (subjectTitle) => {
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
    const view = render(<ActionCard action={action} onRespond={onRespond} />, { wrapper: ThemeProvider })
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

test("an approval in the active chat takes keyboard focus from its draft and confirms the highlighted option", () => {
  const action: PendingAction = {
    id: "keyboard-approval",
    kind: "permission",
    sessionId: "active-chat",
    params: {
      sessionId: "active-chat",
      title: "Run command?",
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "deny", name: "Reject", kind: "reject_once" }
      ]
    }
  }
  const respond = vi.fn()
  const chat = (pending: boolean) => (
    <div data-chat-drop-zone>
      {pending && (
        <div data-session-actions>
          <ActionCard action={action} onRespond={respond} />
        </div>
      )}
      <textarea aria-label="Draft" data-chat-input defaultValue="Keep this draft" />
    </div>
  )
  const view = render(chat(false), { wrapper: ThemeProvider })
  mounted.push(view)
  const draft = view.getByRole("textbox", { name: "Draft" })
  draft.focus()
  view.rerender(chat(true))

  const choices = view.getByRole("listbox", { name: "Run command?" })
  expect(choices).toHaveFocus()
  fireEvent.keyDown(choices, { key: "ArrowDown" })
  const reject = view.getByRole("option", { name: /Reject/ })
  expect(reject).toHaveAttribute("aria-selected", "true")
  expect(choices).toHaveAttribute("aria-activedescendant", reject.id)
  fireEvent.keyDown(choices, { key: "ArrowUp" })
  expect(view.getByRole("option", { name: /Allow once/ })).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(choices, { key: "ArrowDown" })
  fireEvent.keyDown(choices, { key: "Enter" })
  expect(respond).toHaveBeenCalledExactlyOnceWith(action.id, {
    outcome: { outcome: "selected", optionId: "deny" }
  })
  expect(draft).toHaveValue("Keep this draft")
})

test("U shared approval answers the exact pending request through the real ACP client", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const client = new CodexClient(() => Promise.resolve(port), { agentId: "codex", launch: { engine: "codex" } })
  clients.push(client)
  await client.connect()
  const sessionId = await client.newSession("/tmp/approval-test")
  await client.prompt(sessionId, [{ type: "text", text: "permission" }])
  await waitFor(() => expect(client.state.actions.length).toBe(1))
  const action = client.state.actions[0]
  const respond = vi.spyOn(applicationClient, "respond").mockImplementation((id, answer) => client.respond(id, answer))
  try {
    const view = render(<ActionCard action={action} />, { wrapper: ThemeProvider })
    mounted.push(view)
    const list = view.getByRole("listbox")
    fireEvent.keyDown(list, { key: "1" })
    expect(respond).toHaveBeenCalledWith(action.id, { outcome: { outcome: "selected", optionId: "allow_once" } })
    await waitFor(() => expect(client.state.actions.length).toBe(0))
    await waitFor(() => expect(client.session(sessionId).state).toBe("idle"))
    expect(client.session(sessionId).items.some((item) => item.kind === "assistant")).toBe(true)
  } finally {
    respond.mockRestore()
  }
})
