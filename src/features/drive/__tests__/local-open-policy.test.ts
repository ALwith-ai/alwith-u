import { createDriveController, prepareDriveFile, type Snapshot } from "@alwith/module-drive"
import { createEditorController } from "@alwith/module-editor"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import { expect, test, vi } from "vitest"

import { createTreeOpener } from "@/features/workspace/tree-opener"

const host = { maxEditorBytes: 16 * 1024 * 1024, confirmDownload: async () => true, openExternal: vi.fn() }

test.each(["md", "html"])(
  "existing local %s opens while Drive is stopped or its index query is stalled",
  async (extension) => {
    const path = `/drive/library/report.${extension}`
    const adapter = createMemoryAdapter({ [path]: "local content" })
    const fs = createFileSystem({ adapter, reportError: vi.fn() })
    const editor = createEditorController({ fs, confirmClose: async () => "discard", reportError: vi.fn() })
    const state: Snapshot = {
      version: 1,
      generation: 1,
      sequence: 0,
      configured: true,
      running: false,
      baseUrl: "https://drive.example.test",
      localRoot: "/drive",
      webBaseUrl: null,
      status: null,
      roots: [],
      files: [],
      projects: [],
      pendingDeletes: [],
      error: null
    }
    const request = vi.fn(async (request: { type: string }) => {
      if (request.type === "snapshot") return { type: "snapshot" as const, data: { ...state } }
      return new Promise<never>(() => {})
    })
    const drive = createDriveController({ request, subscribe: async () => () => {} })
    const opener = createTreeOpener(editor, (path) =>
      prepareDriveFile(drive, path, { ...host, localFileSize: async (value) => (await fs.stat(value))?.size ?? null })
    )
    try {
      await drive.attach()
      expect(new TextDecoder().decode(await fs.readFile(path))).toBe("local content")
      await opener.open(path, true)
      expect(editor.getSnapshot().documents[0]?.text).toBe("local content")
      expect(request.mock.calls.some(([request]) => request.type === "file")).toBe(false)
      state.running = true
      await drive.refresh()
      await opener.open(path, true)
      expect(editor.getSnapshot().documents[0]?.text).toBe("local content")
      expect(request.mock.calls.every(([request]) => request.type === "snapshot")).toBe(true)
    } finally {
      opener.dispose()
      editor.dispose()
      drive.dispose()
    }
  }
)
