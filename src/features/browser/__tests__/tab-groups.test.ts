import { expect, test } from "vitest"

import { joinGroup, leaveGroup, settleGroup, usedGroups } from "../tab-groups"

const strip = (tabs: { id: string; group?: string }[]) => tabs.map((tab) => `${tab.id}${tab.group ?? ""}`).join(" ")

test("a tab joins a group beside its tabs and leaves it past them", () => {
  const tabs = [{ id: "a", group: "1" }, { id: "b" }, { id: "c", group: "1" }, { id: "d" }]
  // "a" and "c" are not side by side here only to show where a joining tab goes.
  expect(strip(joinGroup(tabs, "d", "1"))).toBe("a1 b c1 d1")
  expect(strip(joinGroup(tabs, "b", "2"))).toBe("a1 b2 c1 d")
  expect(strip(joinGroup([{ id: "p", pinned: true }, ...tabs], "p", "1"))).toBe("p a1 b c1 d")
  const grouped = [{ id: "a", group: "1" }, { id: "b", group: "1" }, { id: "c", group: "1" }, { id: "d" }]
  expect(strip(leaveGroup(grouped, "a"))).toBe("b1 c1 a d")
  expect(strip(leaveGroup(grouped, "d"))).toBe("a1 b1 c1 d")
})

test("a moved tab takes the group it lands in, and leaves the one it was taken from", () => {
  expect(strip(settleGroup([{ id: "a", group: "1" }, { id: "x" }, { id: "b", group: "1" }], "x"))).toBe("a1 x1 b1")
  expect(strip(settleGroup([{ id: "a", group: "1" }, { id: "x" }, { id: "b", group: "2" }], "x"))).toBe("a1 x b2")
  expect(strip(settleGroup([{ id: "a", group: "1" }, { id: "c" }, { id: "x", group: "1" }], "x"))).toBe("a1 c x")
  expect(strip(settleGroup([{ id: "c" }, { id: "x", group: "1" }, { id: "a", group: "1" }], "x"))).toBe("c x1 a1")
  // The only tab of a group carries the group with it.
  expect(strip(settleGroup([{ id: "c" }, { id: "x", group: "1" }, { id: "d" }], "x"))).toBe("c x1 d")
})

test("a group without tabs is gone", () => {
  const groups = [
    { id: "1", title: "Work", color: 1 as const },
    { id: "2", title: "Trip", color: 2 as const }
  ]
  expect(usedGroups(groups, [{ id: "a", group: "2" }, { id: "b" }])).toEqual([groups[1]])
})
