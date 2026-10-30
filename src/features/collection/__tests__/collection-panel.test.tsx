import { applyCollectionAction, initialCollectionData } from "@alwith/module-collection"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import type { SessionSummary } from "@/agent/client"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { AddToCollectionAction, CollectionPicker } from "../collection-menu"
import { CollectionPanel } from "../collection-panel"
import { useCollectionStore } from "../store"
import * as collectionStore from "../store"

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
  const sessionRow = { sessionId: "one", title: "Current Codex title", cwd: "/work", updatedAt: null, archived: false }
  client.store.setState({ sessionList: [sessionRow], sessionListLoaded: true, sessionListError: null })
  const select = vi.fn<(entry: SessionSummary) => void>()
  const screen = render(
    <CollectionPanel
      onSelect={select}
      onNewChat={() => {}}
      renderRow={(entry) => <button onClick={() => select(entry)}>{entry.title}</button>}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Current Codex title" }))
  expect(select).toHaveBeenCalledWith(sessionRow)
  expect(screen.getByText("Chat unavailable")).toBeVisible()
  expect(useCollectionStore.getState().collections.a.sessionIds).toEqual(["one", "missing"])
  act(() => client.store.setState({ sessionList: [{ ...sessionRow, title: "Renamed in Codex" }] }))
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

test("session collection action opens its secondary menu on hover", async () => {
  const screen = render(<AddToCollectionAction sessionId="one" />)
  const trigger = screen.getByRole("button")
  expect(trigger).toHaveAttribute("data-slot", "hover-info-card-action")
  fireEvent.mouseEnter(trigger)
  fireEvent.mouseMove(trigger)
  expect(await screen.findByRole("menuitemradio", { name: "Favorites" })).toBeVisible()
})

test("quick favorite clicks toggle the explicit session without opening the picker", async () => {
  const dispatch = vi.spyOn(collectionStore, "dispatchCollection").mockResolvedValue()
  try {
    const screen = render(<CollectionPicker sessionId="one" favorite />)
    await act(() => Promise.resolve(fireEvent.click(screen.getByRole("button"))))
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "favorite", sessionId: "one" })
    expect(screen.queryByRole("menu")).toBeNull()
  } finally {
    dispatch.mockRestore()
  }
})

test("collection rows receive their group and omit the global remove action", async () => {
  useCollectionStore.setState(
    applyCollectionAction(initialCollectionData(), { type: "create", id: "work", name: "Work", sessionId: "one" }),
    true
  )
  const sessionRow = { sessionId: "one", title: "Saved chat", cwd: "/work", updatedAt: null, archived: false }
  client.store.setState({ sessionList: [sessionRow], sessionListLoaded: false, sessionListError: null })
  const row = vi.fn((entry: SessionSummary, _onHover: (open: boolean) => void, collectionId?: string) => (
    <AddToCollectionAction sessionId={entry.sessionId} allowRemove={collectionId === undefined} />
  ))
  const screen = render(<CollectionPanel onSelect={() => {}} onNewChat={() => {}} renderRow={row} />)
  expect(row).toHaveBeenCalledWith(sessionRow, expect.any(Function), "work")
  expect(screen.queryByText("Loading chats…")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Favorite" }))
  expect(await screen.findByRole("menuitemradio", { name: "Work" })).toBeVisible()
  expect(screen.queryByRole("menuitem", { name: /Remove from all/ })).toBeNull()
})
