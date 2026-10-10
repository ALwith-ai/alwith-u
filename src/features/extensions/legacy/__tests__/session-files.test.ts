import { expect, test, vi } from "vitest"
import { createSessionFiles } from "../session-files"

const threads = [
  { sessionId: "one", cwd: "/work", title: "First", updatedAt: "2026-10-09T00:00:00Z", archived: false },
  { sessionId: "two", cwd: "/other", title: "Second", updatedAt: null, archived: true }
]
const source = () => ({
  list: vi.fn(async () => threads),
  read: vi.fn(
    async (id: string) => `${JSON.stringify({ type: "user", sessionId: id, message: { content: "Hello" } })}\n`
  ),
  check: vi.fn()
})

test("projects Codex sessions into stable read-only legacy paths, scoped by project", async () => {
  const deps = source()
  const files = createSessionFiles("/__alwith_legacy/yup-kb/.alwith/projects", deps)
  const all = await files.listSessions("/__alwith_legacy/yup-kb/.alwith/projects")
  expect(all.map(entry => entry.id)).toEqual(["one", "two"])
  expect(all[0]).toMatchObject({
    kind: "session",
    project_dir: "-work",
    path: "/__alwith_legacy/yup-kb/.alwith/projects/-work/one.jsonl"
  })
  expect(await files.listSessions("/__alwith_legacy/yup-kb/.alwith/projects/-work")).toHaveLength(1)
  expect(await files.file("list", "")).toEqual({
    type: "list",
    entries: [
      { name: "-work", isDirectory: true, isFile: false },
      { name: "-other", isDirectory: true, isFile: false }
    ]
  })
  const read = await files.file("read", "-work/one.jsonl")
  expect(read.type).toBe("read")
  expect(deps.read).toHaveBeenCalledWith("one")
  await expect(files.file("read", "-other/one.jsonl")).rejects.toThrow()
  await expect(files.file("write", "-work/one.jsonl")).rejects.toThrow("只读")
  await expect(files.file("stat", "-work/one.private")).rejects.toThrow("不存在")
  await expect(files.listSessions("/real/.alwith/projects")).rejects.toThrow()
})

test("does not cache transcripts, and propagates running/changed/unavailable history", async () => {
  const deps = source()
  const files = createSessionFiles("/virtual", deps)
  expect(await files.file("stat", "-work/one.jsonl")).toMatchObject({ type: "stat", exists: true, mtime: null })
  deps.read.mockRejectedValueOnce(new Error("history_changed"))
  await expect(files.file("read", "-work/one.jsonl")).rejects.toThrow("history_changed")
  deps.check.mockImplementation(() => {
    throw new Error("disposed")
  })
  await expect(files.file("list", "")).rejects.toThrow("disposed")
})

test("rejects ambiguous Desktop project encodings instead of linking another workspace", async () => {
  const deps = source()
  deps.list.mockResolvedValueOnce([
    { ...threads[0], cwd: "/work-a" },
    { ...threads[1], cwd: "/work/a" }
  ])
  await expect(createSessionFiles("/virtual", deps).listSessions("/virtual")).rejects.toThrow("编码冲突")
})

test("rejects ambiguous projects during archive directory scanning and direct reads", async () => {
  for (const [operation, path] of [
    ["list", ""],
    ["list", "-work-a"],
    ["read", "-work-a/one.jsonl"]
  ] as const) {
    const deps = source()
    deps.list.mockResolvedValueOnce([
      { ...threads[0], cwd: "/work-a" },
      { ...threads[1], cwd: "/work/a" }
    ])
    const files = createSessionFiles("/virtual", deps)
    await expect(files.file(operation, path)).rejects.toThrow("编码冲突")
    expect(deps.read).not.toHaveBeenCalled()
  }
})
