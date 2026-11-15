import { beforeEach, expect, test } from "vitest"

import { loadTabs, saveTabs } from "../tab-store"

beforeEach(() => localStorage.clear())

test("ordinary pages round-trip and the selection follows the kept tabs", () => {
  saveTabs(
    [
      { url: "https://a.example/", title: "A", bound: false },
      { url: "https://ai.example/", title: "AI", bound: true },
      { url: undefined, title: "新标签页", bound: false },
      { url: "about:blank", title: "新标签页", bound: false },
      { url: "http://localhost:5173/", title: "Dev", bound: false }
    ],
    4
  )
  expect(loadTabs()).toEqual({
    tabs: [
      { url: "https://a.example/", title: "A" },
      { url: "http://localhost:5173/", title: "Dev" }
    ],
    selected: 1
  })
})

test("a selection that was not kept falls back to the last kept tab", () => {
  saveTabs(
    [
      { url: "https://a.example/", title: "A", bound: false },
      { url: "https://ai.example/", title: "AI", bound: true }
    ],
    1
  )
  expect(loadTabs()?.selected).toBe(0)
})

test("nothing restorable clears the saved session", () => {
  saveTabs([{ url: "https://a.example/", title: "A", bound: false }], 0)
  saveTabs([{ url: undefined, title: "新标签页", bound: false }], 0)
  expect(loadTabs()).toBeUndefined()
})

test("corrupt or non-web entries are rejected instead of opened", () => {
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({ tabs: [{ url: "file:///etc/passwd", title: "x" }], selected: 0 })
  )
  expect(() => loadTabs()).toThrow("Invalid saved browser tabs")
  localStorage.setItem("alwith.browser.tabs.v1", JSON.stringify({ tabs: "nope", selected: 0 }))
  expect(() => loadTabs()).toThrow("Invalid saved browser tabs")
})

test("a tab keeps the session history that shows its own address and no other", () => {
  const history = {
    entries: [
      { url: "https://a.example/", title: "A" },
      { url: "https://a.example/next", title: "Next" }
    ],
    shown: 1
  }
  saveTabs(
    [
      { url: "https://a.example/next", title: "Next", bound: false, history },
      // The tab moved on before its browser reported the new history.
      { url: "https://b.example/", title: "B", bound: false, history }
    ],
    0
  )
  expect(loadTabs()?.tabs).toEqual([
    { url: "https://a.example/next", title: "Next", history },
    { url: "https://b.example/", title: "B" }
  ])
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({
      tabs: [
        {
          url: "https://a.example/",
          title: "A",
          history: { entries: [{ url: "file:///etc/passwd", title: "x" }], shown: 0 }
        }
      ],
      selected: 0
    })
  )
  expect(() => loadTabs()).toThrow("Invalid saved browser tabs")
})

test("tabs come back in their groups, and a group none of them is in is not kept", () => {
  saveTabs(
    [
      { url: "https://a.example/", title: "A", bound: false, group: "work" },
      { url: "https://b.example/", title: "B", bound: false, group: "work" },
      { url: "https://ai.example/", title: "AI", bound: true, group: "gone" },
      { url: "https://c.example/", title: "C", bound: false }
    ],
    0,
    localStorage,
    [
      { id: "gone", title: "Gone", color: 2 },
      { id: "work", title: "Work", color: 3, collapsed: true }
    ]
  )
  expect(loadTabs()).toEqual({
    tabs: [
      { url: "https://a.example/", title: "A", group: 0 },
      { url: "https://b.example/", title: "B", group: 0 },
      { url: "https://c.example/", title: "C" }
    ],
    selected: 0,
    groups: [{ title: "Work", color: 3, collapsed: true }]
  })
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({ tabs: [{ url: "https://a.example/", title: "A", group: 1 }], selected: 0, groups: [] })
  )
  expect(() => loadTabs()).toThrow("Invalid saved browser tabs")
})

test("the state a page was left in is kept with its entry, and anything else in its place is refused", () => {
  const history = {
    entries: [
      { url: "https://a.example/", title: "A" },
      { url: "https://a.example/long", title: "Long", state: "c3RhdGU=" }
    ],
    shown: 1
  }
  saveTabs([{ url: "https://a.example/long", title: "Long", bound: false, history }], 0)
  expect(loadTabs()?.tabs[0]?.history).toEqual(history)
  localStorage.setItem(
    "alwith.browser.tabs.v1",
    JSON.stringify({
      tabs: [
        {
          url: "https://a.example/",
          title: "A",
          history: { entries: [{ url: "https://a.example/", title: "A", state: 7 }], shown: 0 }
        }
      ],
      selected: 0
    })
  )
  expect(() => loadTabs()).toThrow("Invalid saved browser tabs")
})
