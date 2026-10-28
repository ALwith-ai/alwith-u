import { expect, test, vi } from "vitest"

import { saveModelAlias } from "../model-aliases"
import { settingsStore } from "../settings-store"

vi.mock("../settings-store", () => ({
  settingsStore: { read: vi.fn(), write: vi.fn() }
}))

const id = "gateway:alwith-managed-litellm:deepseek-V4.1-flash"

test("saving an alias preserves other models and uses the latest settings revision", async () => {
  vi.mocked(settingsStore.read).mockResolvedValue({
    revision: 7,
    browserMigrated: true,
    values: { "chat.modelAliases": { "gateway:alwith-managed-litellm:other": "Other" } }
  })
  await saveModelAlias(id, "  My DeepSeek  ")
  expect(settingsStore.write).toHaveBeenLastCalledWith({
    action: "update",
    expectedRevision: 7,
    changes: { "chat.modelAliases": { "gateway:alwith-managed-litellm:other": "Other", [id]: "My DeepSeek" } }
  })
})

test("clearing an alias removes the override and propagates write failures", async () => {
  vi.mocked(settingsStore.read).mockResolvedValue({
    revision: 8,
    browserMigrated: true,
    values: { "chat.modelAliases": { [id]: "Old" } }
  })
  vi.mocked(settingsStore.write).mockRejectedValueOnce(new Error("Settings changed"))
  await expect(saveModelAlias(id, " ")).rejects.toThrow("Settings changed")
  expect(settingsStore.write).toHaveBeenLastCalledWith({
    action: "update",
    expectedRevision: 8,
    changes: { "chat.modelAliases": {} }
  })
})
