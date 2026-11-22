import type { SessionSummary } from "@alwith/module-chat/client"
import { expect, test, vi } from "vitest"

import { createFakeAgent } from "@alwith/module-chat/testing"
import { FakeHubPort } from "@alwith/module-chat/testing"
import { DesktopCodexClient } from "@/lib/desktop-client"

import { deleteChatFolder, latestFolderChat, readChatFolders, saveChatFolder } from "../folder-chat"

vi.mock("@/lib/store", () => ({
  openStore: () => {
    const values = new Map<string, string>()
    return {
      set: async (id: string, path: string) => void values.set(id, path),
      entries: async () => [...values],
      delete: async (id: string) => void values.delete(id)
    }
  }
}))

function session(sessionId: string, updatedAt: string, cwd = "/drive/project"): SessionSummary {
  return { sessionId, updatedAt, cwd, title: sessionId, archived: false }
}

test("nested Drive folders resume the most recent conversation in the same folder and project", async () => {
  const reports = { cwd: "/drive/project", path: "/drive/project/reports" }
  const other = { cwd: "/drive/project", path: "/drive/project/other" }
  await saveChatFolder("old-reports", reports)
  await saveChatFolder("new-reports", reports)
  await saveChatFolder("other", other)
  const rows = [
    session("old-reports", "2026-11-16T00:00:00Z"),
    session("new-reports", "2026-11-17T00:00:00Z"),
    session("other", "2026-11-18T00:00:00Z"),
    session("project-root", "2026-11-19T00:00:00Z"),
    session("another-local-project", "2026-11-20T00:00:00Z", reports.path)
  ]
  expect(latestFolderChat(reports, rows, await readChatFolders())?.sessionId).toBe("new-reports")
  expect(latestFolderChat({ ...reports, path: reports.cwd }, rows, await readChatFolders())?.sessionId).toBe(
    "project-root"
  )
  await deleteChatFolder("new-reports")
  const remaining = rows.filter((row) => row.sessionId !== "new-reports")
  expect(latestFolderChat(reports, remaining, await readChatFolders())?.sessionId).toBe("old-reports")
})

test("a local folder uses its own Codex directory, including existing Windows path aliases", () => {
  const path = "C:/Projects/Reports"
  const rows = [session("local", "2026-11-19T00:00:00Z", "c:\\projects\\reports\\")]
  expect(latestFolderChat({ cwd: path, path }, rows, new Map())?.sessionId).toBe("local")
})

test("a Drive folder reaches Codex as context while the session keeps the project directory", async () => {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const request = vi.spyOn(port, "acpRequest")
  const client = new DesktopCodexClient(() => Promise.resolve(port), {
    agentId: "codex",
    launch: { engine: "codex" },
    imageService: {
      inputMode: async () => "chat",
      selection: vi.fn(),
      generateExternal: vi.fn()
    }
  })
  try {
    await client.connect()
    const id = await client.newSession("/drive/project")
    await client.prompt(id, [{ type: "text", text: "Summarize the reports" }], {
      meta: { workspaceFolder: "/drive/project/reports" }
    })
    expect(client.session(id).cwd).toBe("/drive/project")
    expect(request).toHaveBeenCalledWith(
      "codex",
      "session/prompt",
      expect.objectContaining({
        sessionId: id,
        prompt: [{ type: "text", text: "Summarize the reports" }],
        _meta: expect.objectContaining({
          alwith: expect.objectContaining({
            applicationContext: expect.objectContaining({
              workspaceFolder: 'The user started this conversation in "/drive/project/reports".'
            })
          })
        })
      }),
      expect.any(Object)
    )
  } finally {
    client.disconnect()
  }
})
