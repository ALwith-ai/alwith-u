import { DEFAULT_IMAGE_SELECTION, type ImageSelection } from "@alwith/module-chat/image"
import { beforeEach, expect, test, vi } from "vitest"

import type { SessionInputConfig, SessionInputConfigSnapshot } from "@/agent/input-config"

import {
  configureSessionInputConfig,
  deleteSessionInputMode,
  readSessionImageSelection,
  readSessionInputMode,
  saveSessionImageSelection,
  saveSessionInputMode
} from "../input-mode-config"

const local = vi.hoisted(() => ({ values: new Map<string, unknown>(), get: vi.fn(), set: vi.fn(), delete: vi.fn() }))
vi.mock("@/lib/store", () => ({ openStore: () => local }))
const codex = new Map<string, SessionInputConfigSnapshot>()
const read = vi.fn<(id: string) => Promise<SessionInputConfigSnapshot>>()
const write = vi.fn<(id: string, value: SessionInputConfig) => Promise<SessionInputConfigSnapshot>>()
const selection: ImageSelection = { model: "doubao-seedream-5-0-pro-260628", size: "2K" }

beforeEach(() => {
  vi.resetAllMocks()
  local.values.clear()
  codex.clear()
  local.get.mockImplementation((id: string) => Promise.resolve(local.values.get(id)))
  local.set.mockImplementation((id: string, value: unknown) => {
    local.values.set(id, value)
    return Promise.resolve()
  })
  local.delete.mockImplementation((id: string) => {
    local.values.delete(id)
    return Promise.resolve()
  })
  read.mockImplementation((id) => Promise.resolve(codex.get(id) ?? { sessionId: id, revision: 0, inputConfig: null }))
  write.mockImplementation((id, inputConfig) => {
    const value = { sessionId: id, revision: (codex.get(id)?.revision ?? 0) + 1, inputConfig }
    codex.set(id, value)
    return Promise.resolve(value)
  })
  configureSessionInputConfig({ read, write })
})

test("restores mode, model and resolution from Codex after deleting the local cache", async () => {
  await saveSessionInputMode("image", "image", selection)
  local.values.clear()
  expect(await readSessionInputMode("image")).toBe("image")
  expect(await readSessionImageSelection("image")).toEqual(selection)
  expect(local.values.get("image")).toEqual(codex.get("image"))
})

test("does not migrate or trust a legacy local mode record", async () => {
  local.values.set("legacy", "image")
  expect(await readSessionInputMode("legacy")).toBe("chat")
  expect(await readSessionImageSelection("legacy")).toBeUndefined()
  expect(write).not.toHaveBeenCalled()
})

test("native values replace cached choices and read failures never restore stale cache", async () => {
  await saveSessionInputMode("image", "image", selection)
  codex.set("image", {
    sessionId: "image",
    revision: 2,
    inputConfig: { mode: "image", config: DEFAULT_IMAGE_SELECTION }
  })
  expect(await readSessionImageSelection("image")).toEqual(DEFAULT_IMAGE_SELECTION)
  read.mockRejectedValueOnce(new Error("Codex is disconnected"))
  await expect(readSessionInputMode("image")).rejects.toThrow("Codex is disconnected")
})

test("resolution updates preserve the native input mode and deleting cache does not delete native inputConfig", async () => {
  await saveSessionInputMode("image", "image", selection)
  await saveSessionImageSelection("image", DEFAULT_IMAGE_SELECTION)
  expect(codex.get("image")?.inputConfig).toEqual({ mode: "image", config: DEFAULT_IMAGE_SELECTION })
  await deleteSessionInputMode("image")
  expect(local.values.has("image")).toBe(false)
  expect(codex.get("image")?.inputConfig?.mode).toBe("image")
})

test("a delayed read cannot recreate cache after deleting a session", async () => {
  const pending = Promise.withResolvers<SessionInputConfigSnapshot>()
  read.mockReturnValueOnce(pending.promise)
  const reading = readSessionInputMode("deleted")
  await deleteSessionInputMode("deleted")
  pending.resolve({ sessionId: "deleted", revision: 1, inputConfig: { mode: "image", config: selection } })
  await reading
  expect(local.values.has("deleted")).toBe(false)
})

test("default chat creates no additional persisted record or cache and rejects image settings", async () => {
  await saveSessionInputMode("chat", "chat", {})
  expect(write).not.toHaveBeenCalled()
  expect(local.set).not.toHaveBeenCalled()
  expect(await readSessionInputMode("chat")).toBe("chat")
  await expect(saveSessionImageSelection("chat", selection)).rejects.toThrow("chat session")
})

test("invalid chat configuration is rejected even though chat is not persisted", async () => {
  await expect(saveSessionInputMode("chat", "chat", { model: "wham" })).rejects.toThrow("must be empty")
  expect(write).not.toHaveBeenCalled()
})
