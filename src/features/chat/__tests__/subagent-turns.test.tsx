import { applyUpdate, CodexClient, createSession, type Session } from "@alwith/module-chat/client"
import { ConversationBody, ConversationProvider, SessionActions } from "@alwith/module-chat/conversation"
import { act, fireEvent, render, waitFor, within } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

import { useChatHost } from "../chat-host"
import { navigationSoundStore } from "../codex/navigation-sound-store"

await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })

function message(session: Session, id: string, turnId: string, text: string, user = false): Session {
  const frame = {
    messageId: id,
    content: [{ type: "text" as const, text }],
    _meta: { codex: { turnId } }
  }
  return user
    ? applyUpdate(session, { ...frame, sessionUpdate: "user_message" })
    : applyUpdate(session, { ...frame, sessionUpdate: "agent_message" })
}

function Surface({ client, parent }: { client: CodexClient; parent: Session }) {
  const host = useChatHost()
  return (
    <ConversationProvider host={host} client={client}>
      <ConversationBody session={parent} />
      <SessionActions sessionId={parent.id} />
    </ConversationProvider>
  )
}

function fixture(id: string) {
  const client = new CodexClient(() => Promise.reject(new Error("No Runtime in component tests")), {
    agentId: "test",
    launch: { engine: "fake" }
  })
  const parent = message({ ...createSession(id, "/fixture"), attached: true }, "request", "origin", "Review this", true)
  const child: Session = {
    ...message(createSession(`${id}-child`, "/fixture", "Review sources"), "answer", "child-turn", "Source findings"),
    attached: true,
    state: "running",
    subagent: {
      parentId: id,
      description: "Check the sources",
      capabilities: { cancel: {} },
      _meta: { codex: { threadId: `${id}-native-child`, parentTurnId: "origin" } }
    }
  }
  const readHistory = vi.fn(() => Promise.resolve({ session: createSession("history", "/fixture"), cursor: null }))
  const open = vi.fn(() => Promise.resolve())
  client.readSubagentHistory = readHistory
  client.open = open
  client.store.setState({ connection: "ready", sessions: { [id]: parent, [child.id]: child } })
  const view = render(
    <ThemeProvider>
      <Surface client={client} parent={parent} />
    </ThemeProvider>
  )
  const updateChild = async (patch: Partial<Session>) => {
    await act(() =>
      Promise.try(() =>
        client.store.setState((state) => ({
          sessions: { ...state.sessions, [child.id]: { ...state.sessions[child.id], ...patch } }
        }))
      )
    )
  }
  return { client, parent, child, view, updateChild, open }
}

function workToggle(container: HTMLElement) {
  const toggle = container.querySelector<HTMLButtonElement>(".codex-work-trigger")
  if (toggle === null) throw new Error("Expected a turn process disclosure")
  return toggle
}

test("running tasks live inside their turn process and fold into it when work ends", async () => {
  const { view, updateChild } = fixture("automatic")
  const group = await view.findByRole("region", { name: "Subtasks" })
  const toggle = within(group).getByRole("button", { name: /Subtasks/ })
  const process = workToggle(view.container)
  expect(process).toHaveAttribute("aria-expanded", "true")
  expect(toggle).toHaveAttribute("aria-expanded", "true")
  expect(group.closest(".codex-work-body")).not.toBeNull()
  expect(group.closest("[data-codex-turn]")).not.toBeNull()
  expect(view.container.querySelector("[data-subagent-shelf]")).toBeNull()
  expect(view.queryByText("Source findings")).not.toBeInTheDocument()
  await updateChild({ state: "idle", lastStopReason: "end_turn" })
  expect(process).toHaveAttribute("aria-expanded", "false")
  expect(view.queryByRole("region", { name: "Subtasks" })).not.toBeInTheDocument()
  fireEvent.click(process)
  const completed = within(view.getByRole("region", { name: "Subtasks" })).getByRole("button", { name: /Subtasks/ })
  expect(completed).toHaveAttribute("aria-expanded", "false")
  expect(completed).toHaveTextContent("Completed 1")
})

test("reading a child keeps the group open through completion and never opens another session", async () => {
  const { open, view, updateChild } = fixture("reading")
  fireEvent.click(await view.findByRole("button", { name: /Review sources.*Working/ }))
  expect(await view.findByText("Source findings")).toBeVisible()
  await updateChild({ state: "idle", lastStopReason: "end_turn" })
  expect(workToggle(view.container)).toHaveAttribute("aria-expanded", "true")
  expect(view.getByRole("button", { name: /Subtasks/ })).toHaveAttribute("aria-expanded", "true")
  expect(view.getByText("Source findings")).toBeVisible()
  expect(open).not.toHaveBeenCalled()
})

test("manual collapse is retained and unknown or idle sessions do not count as completed work", async () => {
  const { view, updateChild } = fixture("manual")
  const process = workToggle(view.container)
  fireEvent.click(process)
  fireEvent.click(process)
  const toggle = await view.findByRole("button", { name: /Subtasks/ })
  fireEvent.click(toggle)
  await updateChild({ state: "requires_action" })
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  await updateChild({ state: "unknown", lastStopReason: null })
  expect(toggle).toHaveTextContent("Unknown 1")
  expect(toggle.querySelector(".motion-safe\\:animate-spin")).toBeNull()
  await updateChild({ state: "idle" })
  expect(toggle).toHaveTextContent("Idle 1")
  expect(toggle).not.toHaveTextContent("Completed")
})

test("history restores tasks inside their original collapsed process and lazily reads their bounded transcript", async () => {
  const { client, parent, child, view, open } = fixture("history")
  view.unmount()
  let restored = applyUpdate(parent, {
    sessionUpdate: "tool_call_update",
    toolCallId: "spawn",
    title: "spawnAgent",
    kind: "other",
    status: "completed",
    rawInput: { receiverThreadIds: ["recorded-child"], prompt: "Audit history" },
    _meta: {
      codex: {
        turnId: "origin",
        collaboration: {
          tool: "spawnAgent",
          receiverThreadIds: ["recorded-child"],
          agents: [{ threadId: "recorded-child", nickname: "Historian", state: { status: "completed" } }]
        }
      }
    }
  })
  restored = message(restored, "later", "later-turn", "Another request", true)
  restored = { ...restored, items: restored.items.map((item) => ({ ...item, replayed: true })) }
  const history = message(
    createSession("recorded-child", "/fixture"),
    "saved",
    "recorded-turn",
    "Persisted child result"
  )
  const readHistory = vi.fn(() => Promise.resolve({ session: history, cursor: null }))
  client.readSubagentHistory = readHistory
  client.store.setState({ sessions: { [parent.id]: restored } })
  const replay = render(
    <ThemeProvider>
      <Surface client={client} parent={restored} />
    </ThemeProvider>
  )
  const process = workToggle(replay.container)
  expect(process).toHaveAttribute("aria-expanded", "false")
  expect(replay.queryByRole("region", { name: "Subtasks" })).not.toBeInTheDocument()
  fireEvent.click(process)
  const group = await replay.findByRole("region", { name: "Subtasks" })
  expect(group.closest(".codex-work-body")).not.toBeNull()
  expect(replay.getAllByRole("region", { name: "Subtasks" })).toHaveLength(1)
  const toggle = within(group).getByRole("button", { name: /Subtasks/ })
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  expect(toggle).toHaveTextContent("Completed 1")
  expect(group.closest("[data-codex-turn]")?.textContent).toContain("Review this")
  expect(group.closest("[data-codex-turn]")?.textContent).not.toContain("Another request")
  fireEvent.click(toggle)
  fireEvent.click(within(group).getByRole("button", { name: /Historian.*Completed/ }))
  expect(await replay.findByText("Persisted child result")).toBeVisible()
  expect(readHistory).toHaveBeenCalledWith("recorded-child", "/fixture", null)
  expect(open).not.toHaveBeenCalled()
  expect(client.state.sessions[child.id]).toBeUndefined()
})

test("steering within the same native turn does not duplicate its task group", async () => {
  const { client, parent, view } = fixture("steering")
  view.unmount()
  const steered = message(parent, "steer", "origin", "Also review the tests", true)
  client.store.setState((state) => ({ sessions: { ...state.sessions, [parent.id]: steered } }))
  const replay = render(
    <ThemeProvider>
      <Surface client={client} parent={steered} />
    </ThemeProvider>
  )
  expect(await replay.findAllByRole("region", { name: "Subtasks" })).toHaveLength(1)
})

test("a nested permission remains actionable while its turn group is collapsed", async () => {
  const { client, parent, child, view } = fixture("permission")
  const respond = vi.fn()
  client.respond = respond
  const nested = {
    ...createSession("nested", "/fixture", "Check facts"),
    attached: true,
    subagent: { parentId: child.id, description: null, capabilities: null, _meta: null }
  }
  await act(() =>
    Promise.try(() =>
      client.store.setState((state) => ({
        sessions: { ...state.sessions, nested },
        actions: [
          {
            id: "approval",
            kind: "permission",
            sessionId: nested.id,
            params: {
              sessionId: nested.id,
              title: "Read facts?",
              options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }]
            }
          }
        ]
      }))
    )
  )
  const toggle = await view.findByRole("button", { name: /Subtasks/ })
  fireEvent.click(toggle)
  expect(view.getByText("Check facts")).toBeVisible()
  fireEvent.click(view.getByRole("option", { name: /1\s*Allow once/ }))
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(
      "approval",
      expect.objectContaining({ outcome: { outcome: "selected", optionId: "allow" } })
    )
  )
  expect(client.state.sessions[parent.id]).toBe(parent)
})
