import { applyCollectionAction, initialCollectionData } from "@alwith/module-collection"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { CollectionPicker } from "../collection-menu"
import { CollectionPanel } from "../collection-panel"
import { useCollectionStore } from "../store"

await initI18n("en")
const original = client.state
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  useCollectionStore.setState(initialCollectionData(), true)
})

test("shows Codex titles, opens explicit sessions and retains missing references until removed", () => {
  let data = applyCollectionAction(initialCollectionData(), { type: "create", id: "a", name: "Work", sessionId: "one" })
  data = applyCollectionAction(data, { type: "add", collectionId: "a", sessionId: "missing" })
  useCollectionStore.setState(data, true)
  const thread = { sessionId: "one", title: "Current Codex title", cwd: "/work", updatedAt: null, archived: false }
  client.store.setState({ threads: [thread], threadsLoaded: true, threadsError: null })
  const select = vi.fn()
  const screen = render(
    <CollectionPanel
      onSelect={select}
      onNewChat={() => {}}
      renderRow={(entry) => <button onClick={() => select(entry)}>{entry.title}</button>}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Current Codex title" }))
  expect(select).toHaveBeenCalledWith(thread)
  expect(screen.getByText("Chat unavailable")).toBeVisible()
  expect(useCollectionStore.getState().collections.a.sessionIds).toEqual(["one", "missing"])
  act(() => client.store.setState({ threads: [{ ...thread, title: "Renamed in Codex" }] }))
  expect(screen.getByRole("button", { name: "Renamed in Codex" })).toBeVisible()
})

test("the favorite button opens the group picker with the current membership", async () => {
  useCollectionStore.setState(
    applyCollectionAction(initialCollectionData(), { type: "create", id: "a", name: "Work", sessionId: "one" }),
    true
  )
  const screen = render(<CollectionPicker sessionId="one" />)
  fireEvent.click(screen.getByRole("button"))
  expect(await screen.findByRole("menuitemradio", { name: "Work" })).toHaveAttribute("aria-checked", "true")
  expect(screen.getByRole("menuitemradio", { name: "Work" })).toHaveAttribute("aria-disabled", "true")
})
