import { beforeEach, expect, test, vi } from "vitest"
import type { DriveRequest } from "@alwith/module-drive"
const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }))
import { driveSessionContext } from "../session-context"
beforeEach(() => {
  invoke.mockReset()
})
test("session context injects workspace knowledge without requesting Drive MCP credentials", async () => {
  invoke.mockImplementation(async (_command: string, { request }: { request: DriveRequest }) => {
    if (request.type === "snapshot") return { type: "snapshot", data: { configured: true, generation: 4 } }
    if (request.type === "preferences")
      return { type: "preferences", data: { sessionArchive: false, knowledgeInject: true } }
    if (request.type === "knowledgeContext") {
      expect(request.cwd).toBe("/drive/project-b")
      return { type: "text", data: "Project B knowledge" }
    }
    throw new Error(`Unexpected request ${request.type}`)
  })
  expect(await driveSessionContext("/drive/project-b")).toEqual({
    mcpServers: [],
    appendSystemPrompt: "Project B knowledge"
  })
})
test("profile changes discard assembled knowledge", async () => {
  let generation = 0
  invoke.mockImplementation(async (_command: string, { request }: { request: DriveRequest }) => {
    if (request.type === "snapshot") return { type: "snapshot", data: { configured: true, generation: ++generation } }
    if (request.type === "preferences")
      return { type: "preferences", data: { sessionArchive: false, knowledgeInject: false } }
    throw new Error(`Unexpected request ${request.type}`)
  })
  await expect(driveSessionContext("/drive/project-a")).rejects.toThrow("configuration changed")
})
test("unconfigured Drive does not inject or request credentials", async () => {
  invoke.mockResolvedValue({ type: "snapshot", data: { configured: false } })
  expect(await driveSessionContext("/project")).toEqual({ mcpServers: [] })
  expect(invoke).toHaveBeenCalledTimes(1)
})

test("configured Drive with knowledge disabled contributes no session tools or prompt", async () => {
  invoke.mockImplementation(async (_command: string, { request }: { request: DriveRequest }) => {
    if (request.type === "snapshot") return { type: "snapshot", data: { configured: true, generation: 4 } }
    if (request.type === "preferences")
      return { type: "preferences", data: { sessionArchive: true, knowledgeInject: false } }
    throw new Error(`Unexpected request ${request.type}`)
  })
  expect(await driveSessionContext("/project")).toEqual({ mcpServers: [] })
})
