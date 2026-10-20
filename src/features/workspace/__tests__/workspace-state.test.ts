import { beforeEach, expect, test, vi } from "vitest"

import { createWorkspaceStateStore } from "../workspace-state"

beforeEach(() => localStorage.clear())

test("restores project tabs and tree preferences without persisting document bodies", async () => {
  const store = createWorkspaceStateStore()
  await store.save("/a", {
    tabs: [{ path: "/a/one.md", pinned: true }],
    activePath: "/a/one.md",
    expanded: ["/a", "/a/docs"],
    showHidden: true,
    showIgnored: false,
    iconTheme: "material-icon-theme"
  })
  expect(await createWorkspaceStateStore().load("/a")).toEqual({
    tabs: [{ path: "/a/one.md", pinned: true }],
    activePath: "/a/one.md",
    expanded: ["/a", "/a/docs"],
    showHidden: true,
    showIgnored: false,
    iconTheme: "material-icon-theme"
  })
  expect(await store.load("/b")).toBeNull()
  expect(localStorage.getItem("workspace:/a")).not.toContain("text")
})

test("rejects stored paths outside the project and malformed preferences", async () => {
  localStorage.setItem("workspace:/a", JSON.stringify({ tabs: [{ path: "/b/private.txt", pinned: true }] }))
  await expect(createWorkspaceStateStore().load("/a")).rejects.toThrow()
})

test("propagates failed persistence and allows a later save", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("disk full")
  })
  const store = createWorkspaceStateStore()
  const state = {
    tabs: [],
    activePath: null,
    expanded: ["/a"],
    showHidden: false,
    showIgnored: false,
    iconTheme: "vscode-icons" as const
  }
  await expect(store.save("/a", state)).rejects.toThrow("disk full")
  await store.save("/a", state)
  expect(await store.load("/a")).toEqual(state)
  write.mockRestore()
})

test("rejects malformed mixed-tab state and paths escaping the workspace", async () => {
  const state = {
    tabs: [],
    activePath: null,
    expanded: ["/a"],
    showHidden: false,
    showIgnored: false,
    iconTheme: "vscode-icons"
  }
  for (const tabLayout of [
    { tabs: [{ kind: "file", path: "/b/secret.txt" }], activeIndex: 0 },
    { tabs: [{ kind: "new" }], activeIndex: 1 },
    { tabs: [{ kind: "new" }], activeIndex: -1 },
    { tabs: [{ kind: "unknown" }], activeIndex: 0 },
    {
      tabs: [
        { kind: "file", path: "/a/file.txt" },
        { kind: "file", path: "/a/file.txt" }
      ],
      activeIndex: 0
    }
  ]) {
    localStorage.setItem("workspace:/a", JSON.stringify({ ...state, tabLayout }))
    await expect(createWorkspaceStateStore().load("/a")).rejects.toThrow()
  }
})
