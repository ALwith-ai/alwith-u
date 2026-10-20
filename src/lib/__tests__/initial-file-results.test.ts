import { afterEach, expect, test, vi } from "vitest"

import { initialFileResults } from "../initial-file-results"

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
afterEach(() => native.invoke.mockReset())

test("one native walk supplies bare @ and typed queries without repeated IPC", async () => {
  native.invoke.mockResolvedValue({ root: "/project", paths: ["/project/a.txt", "/project/src/nested.ts"] })
  const results = await Promise.all([
    initialFileResults("/project-alias"),
    initialFileResults("/project-alias", "snt"),
    initialFileResults("/project-alias")
  ])
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("workspace_list_files", { path: "/project-alias" })
  expect(results[0].map((file) => file.path)).toEqual(["a.txt", "src/nested.ts"])
  expect(results[1]).toEqual([
    { root: "/project", path: "src/nested.ts", file_name: "nested.ts", match_type: "file", score: 0, indices: null }
  ])
  expect(results[2]).toEqual(results[0])
  expect(await initialFileResults("/project-alias", "no-match")).toEqual([])
  expect(native.invoke).toHaveBeenCalledTimes(1)
})

test("empty projects are cached and switching projects reloads the list", async () => {
  native.invoke.mockResolvedValue({ root: "/empty", paths: [] })
  await initialFileResults("/empty")
  await initialFileResults("/empty")
  expect(native.invoke).toHaveBeenCalledTimes(1)
  native.invoke.mockResolvedValue({ root: "/other", paths: ["/other/new.txt"] })
  expect((await initialFileResults("/other"))[0].path).toBe("new.txt")
  native.invoke.mockResolvedValue({ root: "/empty", paths: ["/empty/created.txt"] })
  expect((await initialFileResults("/empty"))[0].path).toBe("created.txt")
  expect(native.invoke).toHaveBeenCalledTimes(3)
})

test("a failed old project does not invalidate a newer project's cached result", async () => {
  let reject!: (error: Error) => void
  native.invoke.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      })
  )
  const old = initialFileResults("/old")
  const failure = expect(old).rejects.toThrow("Project unavailable")
  native.invoke.mockResolvedValue({ root: "/new", paths: ["/new/ok.txt"] })
  await initialFileResults("/new")
  reject(new Error("Project unavailable"))
  await failure
  expect((await initialFileResults("/new"))[0].path).toBe("ok.txt")
  expect(native.invoke).toHaveBeenCalledTimes(2)
})

test("a failed scan is surfaced and can be retried", async () => {
  native.invoke.mockRejectedValueOnce(new Error("Project unavailable"))
  await expect(initialFileResults("/missing")).rejects.toThrow("Project unavailable")
  native.invoke.mockResolvedValue({ root: "/missing", paths: [] })
  expect(await initialFileResults("/missing")).toEqual([])
  expect(native.invoke).toHaveBeenCalledTimes(2)
})
