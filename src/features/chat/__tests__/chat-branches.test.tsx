import { act } from "react"
import { createSession } from "@alwith/api"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"
import type { ThreadSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ChatBranchMenu, ChatBranchProvider, ForkTurnButton } from "../chat-branches"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
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
      <ChatBranchMenu />
    </ChatBranchProvider>
  )
  mounted.push(view)
  return view
}

test("a completed reply forks its explicit turn once and navigates to the returned session", async () => {
  let finish!: (id: string) => void
  const call = spyOn(client, "fork").mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  restores.push(() => call.mockRestore())
  const selected: ThreadSummary[] = []
  const view = setup(thread => selected.push(thread))
  const button = view.getByRole("button", { name: "Create chat branch" })
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
  const call = spyOn(client, "fork").mockRejectedValue(new Error("Cannot fork this turn"))
  const error = spyOn(toast, "error").mockImplementation(() => "error")
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
  const call = spyOn(client, "fork").mockImplementation(
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

test("the branch menu fetches related chats and switches by explicit id", async () => {
  const list = spyOn(client, "listBranches").mockResolvedValue([forked])
  restores.push(() => list.mockRestore())
  const selected: ThreadSummary[] = []
  const view = setup(thread => selected.push(thread))
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Chat branches" }))
  })
  const item = await view.findByRole("menuitem", { name: /New branch/ })
  expect(list).toHaveBeenCalledWith("source")
  await act(async () => {
    fireEvent.click(item)
  })
  expect(selected).toEqual([forked])
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
