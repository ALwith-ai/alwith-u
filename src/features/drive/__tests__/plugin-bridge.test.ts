import { expect, test, vi } from "vitest"
import type { ExtensionData, Json, DataSnapshot } from "@alwith/module-extension"
import type { DriveRequest, DriveResponse } from "@alwith/module-drive"
import {
  assertPluginSessionArchiveAllowed,
  setDriveArchiveOwner,
  syncDrivePlugin,
  type PluginBridgeHost
} from "../plugin-bridge"

function fixture() {
  const state = { generation: 1, configured: true, archive: false, token: "first-token" }
  let stored: DataSnapshot = {
    generation: 1,
    schemaVersion: 1,
    revision: 3,
    value: { webBase: "https://custom.example.test", custom: 42, token: "old" }
  }
  const write = vi.fn(async (value: Json, expected: number | null, schemaVersion: number): Promise<DataSnapshot> => {
    expect(expected).toBe(stored.revision)
    stored = { generation: 1, schemaVersion, revision: stored.revision + 1, value }
    return stored
  })
  const data: ExtensionData = { read: async () => stored, write, subscribe: () => () => {} }
  const selected = { data, schemaVersion: 1 }
  const request = vi.fn(async (request: DriveRequest): Promise<DriveResponse> => {
    if (request.type === "snapshot")
      return {
        type: "snapshot",
        data: {
          version: 1,
          generation: state.generation,
          sequence: 0,
          configured: state.configured,
          running: true,
          baseUrl: "https://drive.example.test",
          localRoot: "/drive",
          webBaseUrl: null,
          status: null,
          roots: [],
          pendingDeletes: [],
          files: [],
          projects: [],
          error: null
        }
      }
    if (request.type === "preferences")
      return { type: "preferences", data: { sessionArchive: state.archive, knowledgeInject: false } }
    if (request.type === "mcpSessionConfig")
      return {
        type: "mcpSessionConfig",
        data: {
          url: "https://drive.example.test/mcp/drive",
          headers: [{ name: "Authorization", value: `Bearer ${state.token}` }]
        }
      }
    throw new Error("Unexpected bridge request")
  })
  const decline = vi.fn(async (check: () => void) => {
    check()
  })
  const archive = vi.fn()
  const host: PluginBridgeHost = {
    request,
    binding: () => selected,
    generation: () => state.generation,
    setArchiveOwner: archive,
    declineSessionSync: decline
  }
  return { state, data, stored: () => stored.value, write, request, decline, archive, host }
}

test("login merges credentials into the existing CAS store and logout clears the token", async () => {
  const f = fixture()
  await syncDrivePlugin(f.host, () => false)
  expect(f.stored()).toEqual({
    webBase: "https://custom.example.test",
    custom: 42,
    token: "first-token",
    baseUrl: "https://drive.example.test",
    _alwithUDrive: true
  })
  expect(f.write).toHaveBeenCalledWith(expect.anything(), 3, 1)
  f.state.configured = false
  f.state.generation++
  await syncDrivePlugin(f.host, () => false)
  expect(f.stored()).toEqual(expect.objectContaining({ token: "", custom: 42 }))
  expect(f.stored()).not.toHaveProperty("_alwithUDrive")
})

test("an unconfigured Drive preserves the plugin's independent login", async () => {
  const f = fixture()
  f.state.configured = false
  await syncDrivePlugin(f.host, () => false)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.stored()).toEqual({ webBase: "https://custom.example.test", custom: 42, token: "old" })
  expect(f.request).not.toHaveBeenCalledWith({ type: "mcpSessionConfig" })
})

test("archive takeover declines both plugin stores and disabling Drive never re-enables plugin consent", async () => {
  const f = fixture()
  f.state.archive = true
  await syncDrivePlugin(f.host, () => false)
  expect(f.stored()).toEqual(expect.objectContaining({ _sessionsSync: { consented: "declined" } }))
  expect(f.decline).toHaveBeenCalledOnce()
  f.state.archive = false
  await syncDrivePlugin(f.host, () => false)
  expect(f.archive).toHaveBeenLastCalledWith(false)
  expect(f.stored()).toEqual(expect.objectContaining({ _sessionsSync: { consented: "declined" } }))
  expect(f.decline).toHaveBeenCalledOnce()
})

test("generation change during credential retrieval never writes the prior account", async () => {
  const f = fixture()
  const request = f.host.request
  f.host.request = async value => {
    const response = await request(value)
    if (value.type === "mcpSessionConfig") f.state.generation++
    return response
  }
  await syncDrivePlugin(f.host, () => false)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.decline).not.toHaveBeenCalled()
})

test("a concurrently saved configuration is reread after CAS conflict", async () => {
  const f = fixture()
  f.write.mockRejectedValueOnce({ code: "conflict", message: "data revision changed" })
  await syncDrivePlugin(f.host, () => false)
  expect(f.write).toHaveBeenCalledTimes(2)
  expect(f.stored()).toEqual(expect.objectContaining({ token: "first-token", custom: 42 }))
})

test("uninstalled plugins receive no credentials or private file writes", async () => {
  const f = fixture()
  f.host.binding = () => null
  await syncDrivePlugin(f.host, () => false)
  expect(f.write).not.toHaveBeenCalled()
  expect(f.request).not.toHaveBeenCalledWith({ type: "mcpSessionConfig" })
  expect(f.decline).not.toHaveBeenCalled()
})

test("plugin session reads stop while Drive owns archival and while preferences load", () => {
  setDriveArchiveOwner(null)
  expect(assertPluginSessionArchiveAllowed).toThrow("loading")
  setDriveArchiveOwner(true)
  expect(assertPluginSessionArchiveAllowed).toThrow("managed by Drive")
  setDriveArchiveOwner(false)
  expect(assertPluginSessionArchiveAllowed).not.toThrow()
})
