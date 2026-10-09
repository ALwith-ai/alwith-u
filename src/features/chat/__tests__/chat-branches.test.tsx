import { applyUpdate, createSession } from "@alwith/api"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { act } from "react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"
import type { ThreadSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ChatBranchProvider, ForkOriginDivider, ForkTurnButton } from "../chat-branches"

await initI18n("en")
const initial = client.state
const mounted: Array<ReturnType<typeof render>> = []
const restores: Array<() => void> = []
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount()
    for (const restore of restores.splice(0)) restore()
    client.store.setState(initial, true)
  })
})
const source = { ...createSession("source", "/project"), attached: true }
const forked: ThreadSummary = {
  sessionId: "child",
  cwd: "/project",
  title: "New branch",
  archived: false,
  updatedAt: null
}
function setup(select: (thread: ThreadSummary) => void) {
  client.store.setState({
    connection: "ready",
    agent: {
      info: { name: "test", version: "1" },
      protocolVersion: 2,
      capabilities: { session: { fork: {} }, _meta: { codex: { forkAtTurn: true, sessionLineage: true } } }
    }
  })
  const view = render(
    <ChatBranchProvider session={source} onSelect={select}>
      <ForkTurnButton turnId="real-turn" />
      <ForkOriginDivider />
    </ChatBranchProvider>
  )
  mounted.push(view)
  return view
}

test("a completed reply forks its explicit turn once and navigates to the returned session", async () => {
  let finish!: (id: string) => void
  const call = vi.spyOn(client, "fork").mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  restores.push(() => call.mockRestore())
  const selected: ThreadSummary[] = []
  const view = setup(thread => selected.push(thread))
  const button = view.getByRole("button", { name: "Create chat branch" })
  expect(button.classList.contains("codex-message-action")).toBe(true)
  expect(view.queryByRole("button", { name: "Chat branches" })).toBeNull()
  await act(async () => {
    fireEvent.click(button)
  })
  await act(async () => {
    fireEvent.click(button)
  })
  expect(call).toHaveBeenCalledTimes(1)
  expect(call).toHaveBeenCalledWith("source", "/project", "real-turn")
  expect(selected).toEqual([])
  client.store.setState({ threads: [forked] })
  await act(async () => {
    finish("child")
  })
  await waitFor(() => expect(selected).toEqual([forked]))
})

test("a fork failure keeps the current chat and allows retry", async () => {
  const call = vi.spyOn(client, "fork").mockRejectedValue(new Error("Cannot fork this turn"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  restores.push(
    () => call.mockRestore(),
    () => error.mockRestore()
  )
  const selected: ThreadSummary[] = []
  const view = setup(thread => selected.push(thread))
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Create chat branch" }))
  })
  await waitFor(() => expect(error).toHaveBeenCalledWith("Cannot fork this turn"))
  expect(selected).toEqual([])
  await waitFor(() =>
    expect((view.getByRole("button", { name: "Create chat branch" }) as HTMLButtonElement).disabled).toBe(false)
  )
})

test("a late fork cannot navigate after its source view is unmounted", async () => {
  let finish!: (id: string) => void
  const call = vi.spyOn(client, "fork").mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  restores.push(() => call.mockRestore())
  const selected: ThreadSummary[] = []
  const view = setup(thread => selected.push(thread))
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Create chat branch" }))
  })
  view.unmount()
  client.store.setState({ threads: [forked] })
  await act(async () => {
    finish("child")
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(selected).toEqual([])
})

test("the inherited-history divider returns to the exact parent and stays before child turns", async () => {
  const read = vi.spyOn(client, "readThreadSummary").mockResolvedValue({
    ...forked,
    sessionId: "parent",
    title: "Original"
  })
  restores.push(() => read.mockRestore())
  client.store.setState({ forkOrigins: { source: { sourceId: "parent", boundaryTurnId: "boundary" } } })
  const selected: ThreadSummary[] = []
  let view!: ReturnType<typeof setup>
  await act(async () => {
    view = setup(thread => selected.push(thread))
  })
  const { groupTurns } = await import("../turns")
  const session = {
    ...source,
    items: [
      {
        kind: "assistant" as const,
        id: "answer",
        content: [{ type: "text" as const, text: "Kept" }],
        _meta: { codex: { turnId: "boundary" } },
        at: 1,
        echo: null,
        replayed: true
      }
    ]
  }
  const turn = groupTurns(session)[0]
  await act(async () => {
    view.rerender(
      <ChatBranchProvider session={session} onSelect={thread => selected.push(thread)}>
        <ForkOriginDivider turn={turn} />
        <ForkOriginDivider turn={{ ...turn, items: [] }} />
      </ChatBranchProvider>
    )
  })
  expect(read).not.toHaveBeenCalled()
  const button = view.getByRole("button", { name: "Continue from original chat", exact: true })
  expect(view.queryByText("Original")).toBeNull()
  expect(view.container.querySelectorAll("[data-fork-origin]").length).toBe(1)
  await act(async () => {
    fireEvent.click(button)
  })
  expect(read).toHaveBeenCalledWith("parent")
  expect(selected[0]?.sessionId).toBe("parent")
  await act(async () => {
    client.store.setState({ forkOrigins: { source: { sourceId: "parent", boundaryTurnId: null } } })
    view.rerender(
      <ChatBranchProvider session={source} onSelect={() => {}}>
        <ForkOriginDivider />
        <ForkOriginDivider turn={{ ...turn, items: [{ ...turn.items[0], _meta: null }] }} />
      </ChatBranchProvider>
    )
  })
  expect(view.container.querySelectorAll("[data-fork-origin]").length).toBe(1)
})

test("turn forks stay hidden when the adapter has no turn boundary support", async () => {
  const view = setup(() => {})
  await act(async () => {
    client.store.setState({
      agent: { info: { name: "test", version: "1" }, protocolVersion: 2, capabilities: { session: { fork: {} } } }
    })
  })
  view.rerender(
    <ChatBranchProvider session={source} onSelect={() => {}}>
      <ForkTurnButton turnId="real-turn" />
    </ChatBranchProvider>
  )
  expect(view.queryByRole("button", { name: "Create chat branch" })).toBeNull()
})

test("several user messages in one native turn place the origin only after its last UI batch", async () => {
  const { groupTurns } = await import("../turns")
  let session = { ...source, restoring: true }
  for (const [index, turnId] of ["boundary", "boundary", "child"].entries()) {
    session = applyUpdate(session, {
      sessionUpdate: "user_message",
      messageId: `u${index}`,
      content: [{ type: "text", text: "prompt" }],
      _meta: { codex: { turnId } }
    })
    session = applyUpdate(session, {
      sessionUpdate: "agent_message",
      messageId: `a${index}`,
      content: [{ type: "text", text: "answer" }],
      _meta: { codex: { turnId } }
    })
  }
  client.store.setState({ forkOrigins: { source: { sourceId: "parent", boundaryTurnId: "boundary" } } })
  const turns = groupTurns(session)
  const view = render(
    <ChatBranchProvider session={session} onSelect={() => {}}>
      <ForkOriginDivider />
      {turns.map(turn => (
        <div key={turn.key} data-batch={turn.key}>
          <ForkOriginDivider turn={turn} />
        </div>
      ))}
    </ChatBranchProvider>
  )
  mounted.push(view)
  expect(view.container.querySelectorAll("[data-fork-origin]")).toHaveLength(1)
  expect(view.container.querySelector("[data-fork-origin]")?.parentElement?.getAttribute("data-batch")).toBe(
    turns[1].key
  )
})
