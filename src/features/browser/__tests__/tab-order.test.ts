import { expect, test } from "vitest"

import { insertAfter, moveTab, moveTo, pinTab } from "../tab-order"

const ids = (tabs: { id: string; pinned?: boolean }[]) => tabs.map((tab) => (tab.pinned ? `${tab.id}*` : tab.id))
const tabs = [{ id: "a", pinned: true }, { id: "b", pinned: true }, { id: "c" }, { id: "d" }, { id: "e" }]

test("a tab is dragged among its own kind only", () => {
  expect(ids(moveTab(tabs, "e", "c"))).toEqual(["a*", "b*", "e", "c", "d"])
  expect(ids(moveTab(tabs, "c", "e"))).toEqual(["a*", "b*", "d", "e", "c"])
  expect(ids(moveTab(tabs, "b", "a"))).toEqual(["b*", "a*", "c", "d", "e"])
  // Not across the line between pinned tabs and the rest, and not onto nothing.
  expect(ids(moveTab(tabs, "c", "a"))).toEqual(ids(tabs))
  expect(ids(moveTab(tabs, "a", "d"))).toEqual(ids(tabs))
  expect(ids(moveTab(tabs, "c", "gone"))).toEqual(ids(tabs))
})

test("pinning takes a tab to the end of the pinned ones, unpinning to the head of the rest", () => {
  expect(ids(pinTab(tabs, "e", true))).toEqual(["a*", "b*", "e*", "c", "d"])
  expect(ids(pinTab(tabs, "a", false))).toEqual(["b*", "a", "c", "d", "e"])
  expect(ids(pinTab(tabs, "a", true))).toEqual(ids(tabs))
})

test("a copy sits right after its tab", () => {
  expect(ids(insertAfter(tabs, "c", { id: "x" }))).toEqual(["a*", "b*", "c", "x", "d", "e"])
  expect(ids(insertAfter(tabs, "gone", { id: "x" }))).toEqual(["a*", "b*", "c", "d", "e", "x"])
})

test("a tab is put at a place along the whole strip, within its own kind", () => {
  expect(ids(moveTo(tabs, "e", 2))).toEqual(["a*", "b*", "e", "c", "d"])
  expect(ids(moveTo(tabs, "c", 4))).toEqual(["a*", "b*", "d", "e", "c"])
  // Negative is the end; a place among the pinned ones is the first after them.
  expect(ids(moveTo(tabs, "c", -1))).toEqual(["a*", "b*", "d", "e", "c"])
  expect(ids(moveTo(tabs, "e", 0))).toEqual(["a*", "b*", "e", "c", "d"])
  // A pinned tab stays among the pinned.
  expect(ids(moveTo(tabs, "a", 4))).toEqual(["b*", "a*", "c", "d", "e"])
  expect(ids(moveTo(tabs, "missing", 0))).toEqual(ids(tabs))
})
