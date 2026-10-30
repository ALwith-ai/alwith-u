import { ConversationProvider, SessionActions } from "@alwith/module-chat/conversation"
import { SessionTimeline } from "@alwith/module-chat/session-timeline"
import { applyUpdate, CodexClient, createSession, type Session } from "@nyssance/codex-acp-v2/client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, waitFor } from "storybook/test"

import { useChatHost } from "../../../src/features/chat/chat-host"

function message(session: Session, text: string) {
  return applyUpdate(session, {
    sessionUpdate: "agent_message",
    messageId: "answer",
    content: [{ type: "text", text }]
  })
}
function fixture() {
  const client = new CodexClient(() => Promise.reject(new Error("Preview has no runtime")), {
    agentId: "preview",
    launch: { engine: "mock" }
  })
  const parent = message(
    { ...createSession("parent", "/preview"), attached: true },
    "I’m comparing the protocol changes and checking the two clients."
  )
  const child = message(
    {
      ...createSession("worker", "/preview", "Protocol review"),
      attached: true,
      state: "running",
      subagent: {
        parentId: parent.id,
        description: "Check child messages, approvals and cancellation",
        capabilities: { cancel: {} },
        _meta: null
      }
    },
    "Child messages arrive on their own session. The parent keeps ownership and approvals remain accessible."
  )
  const nested = message(
    {
      ...createSession("nested", "/preview", "Compatibility check"),
      attached: true,
      state: "requires_action",
      subagent: { parentId: child.id, description: "Verify U and TV", capabilities: { cancel: {} }, _meta: null }
    },
    "The shared client supports both applications. Permission is required to inspect the fixture directory."
  )
  client.store.setState({
    connection: "ready",
    sessions: { parent, worker: child, nested },
    actions: [
      {
        id: "approval",
        kind: "permission",
        sessionId: nested.id,
        params: {
          sessionId: nested.id,
          title: "Read fixture directory?",
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow once" },
            { optionId: "reject", kind: "reject_once", name: "Reject" }
          ]
        }
      }
    ]
  })
  client.cancel = (id) => {
    client.store.setState((state) => ({
      sessions: { ...state.sessions, [id]: { ...state.sessions[id], state: "idle" } }
    }))
    return Promise.resolve()
  }
  client.respond = (id) => {
    client.store.setState((state) => ({
      actions: state.actions.filter((action) => action.id !== id),
      sessions: { ...state.sessions, nested: { ...state.sessions.nested, state: "running" } }
    }))
  }
  return { client, parent }
}
function Preview() {
  const [{ client, parent }] = useState(fixture)
  const host = useChatHost()
  return (
    <ConversationProvider host={host} client={client}>
      <div className="flex h-[640px] min-w-0 flex-col">
        <SessionTimeline session={parent} client={client} host={host} />
        <SessionActions sessionId={parent.id} />
      </div>
    </ConversationProvider>
  )
}
const meta = { title: "页面/主窗聊天/子智能体", component: Preview, globals: { locale: "en" } } satisfies Meta<
  typeof Preview
>
export default meta
type Story = StoryObj<typeof meta>
export const NestedApproval: Story = {
  name: "嵌套授权请求",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Protocol review Needs input/ }))
    await waitFor(async () => {
      await expect(canvas.getByText(/Child messages arrive/)).toBeVisible()
    })
    await userEvent.click(canvas.getByRole("button", { name: /Compatibility check Needs input/ }))
    await waitFor(async () => {
      await expect(canvas.getByText(/The shared client supports/)).toBeVisible()
    })
    await userEvent.click(canvas.getByRole("option", { name: "1 Allow once" }))
    await waitFor(async () => {
      await expect(canvas.queryByRole("listbox")).toBeNull()
    })
    await userEvent.click(canvas.getByRole("button", { name: "Stop Compatibility check" }))
    await waitFor(async () => {
      await expect(canvas.queryByRole("button", { name: "Stop Compatibility check" })).toBeNull()
    })
  }
}
