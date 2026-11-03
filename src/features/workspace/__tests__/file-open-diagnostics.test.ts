import { createEditorController } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { beforeEach, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  info: vi.fn(async (_message: string) => {}),
  error: vi.fn(async (_message: string) => {}),
  snapshot: vi.fn(() => ({
    connected: true,
    error: null,
    snapshot: { configured: true, running: false, generation: 4, roots: [], files: [], error: "startup failed" }
  }))
}))
vi.mock("@tauri-apps/plugin-log", () => ({ info: mocks.info, error: mocks.error }))
vi.mock("@/features/drive/controller", () => ({ drive: { getSnapshot: mocks.snapshot } }))

import { traceFileOpen } from "../file-open-diagnostics"
import { createTreeOpener } from "../tree-opener"

beforeEach(() => vi.clearAllMocks())

test("a blocked prepare records file identity, stage, empty Drive state and the original failure", async () => {
  const failure = new Error("Start Drive before opening its files")
  await expect(
    traceFileOpen("/drive/library/report.md", "tree", async (stage) => {
      stage("prepare")
      throw failure
    })
  ).rejects.toBe(failure)
  const message = mocks.error.mock.calls[0]![0]
  expect(message).toContain('"path":"/drive/library/report.md"')
  expect(message).toContain('"stage":"prepare"')
  expect(message).toContain('"running":false')
  expect(message).toContain('"roots":0')
  expect(message).toContain("Start Drive before opening its files")
  expect(mocks.info.mock.calls.some(([message]) => message.includes('"stage":"completed"'))).toBe(false)
})

test("a pending editor read leaves a stage record before completion and preserves the result", async () => {
  let finish!: (value: string) => void
  const pending = traceFileOpen("/drive/library/report.html", "workspace", async (stage) => {
    stage("editor-open")
    return new Promise<string>((resolve) => {
      finish = resolve
    })
  })
  expect(mocks.info.mock.calls.at(-1)![0]).toContain('"stage":"editor-open"')
  finish("opened")
  await expect(pending).resolves.toBe("opened")
  expect(mocks.info.mock.calls.at(-1)![0]).toContain('"stage":"completed"')
  expect(mocks.error).not.toHaveBeenCalled()
})

test("a second tree click is recorded while an earlier cloud preparation is still pending", async () => {
  const fs = createFileSystem({
    adapter: createMemoryAdapter({ "/drive/a.md": "A", "/drive/b.html": "B" }),
    reportError: vi.fn()
  })
  const editor = createEditorController({ fs, confirmClose: async () => "discard", reportError: vi.fn() })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const opener = createTreeOpener(editor, async (path) => {
    await gate
    return path
  })
  const opens: Promise<void>[] = []
  try {
    const first = opener.open("/drive/a.md")
    const second = opener.open("/drive/b.html")
    opens.push(first, second)
    await Promise.resolve()
    expect(
      mocks.info.mock.calls.some(
        ([message]) => message.includes('"path":"/drive/b.html"') && message.includes('"stage":"queued"')
      )
    ).toBe(true)
    expect(editor.getSnapshot().documents).toHaveLength(0)
    release()
    await Promise.all([first, second])
    expect(editor.getSnapshot().documents[0]?.path).toBe("/drive/b.html")
  } finally {
    release()
    await Promise.allSettled(opens)
    opener.dispose()
    editor.dispose()
  }
})
