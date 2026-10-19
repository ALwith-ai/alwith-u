import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { createVoiceSettingsHost } from "../settings"
let fixture: ReturnType<typeof settingsFixture>
beforeEach(() => {
  fixture = settingsFixture()
})
afterEach(() => vi.restoreAllMocks())
test("the form submits credentials and preferences in one native commit", async () => {
  const host = createVoiceSettingsHost()
  const settings = await host.load()
  await host.saveCredential("vui", "test-key")
  expect(fixture.values.has("voice.vui.apiKey")).toBe(false)
  await host.save({ ...settings, provider: "vui" })
  expect(fixture.values.get("voice.provider")).toBe("vui")
  expect(fixture.write).toHaveBeenCalledOnce()
  expect(fixture.write.mock.calls[0][0]).toMatchObject({
    action: "saveVoice",
    apiKey: "test-key",
    changes: { "voice.provider": "vui" }
  })
})
test("failed submissions do not retain staged credentials for a later unrelated save", async () => {
  const host = createVoiceSettingsHost()
  const settings = await host.load()
  await host.saveCredential("doubao", "test-key")
  fixture.write.mockRejectedValueOnce(new Error("Disk full"))
  await expect(host.save(settings)).rejects.toThrow("Disk full")
  expect(fixture.values.size).toBe(0)
  await host.save(settings)
  expect(fixture.write.mock.calls[1][0].apiKey).toBeNull()
})
test("a stale voice form cannot overwrite another window, but unrelated settings do not conflict", async () => {
  const host = createVoiceSettingsHost()
  const settings = await host.load()
  fixture.changed({ "voice.enabled": false, "appearance.theme": "dark" })
  await host.save(settings)
  fixture.changed({ "voice.provider": "vui" })
  await expect(host.save(settings)).rejects.toThrow("Voice settings changed in another window")
  expect(fixture.values.get("voice.provider")).toBe("vui")
})

test("native object key ordering does not cause a false voice form conflict", async () => {
  const host = createVoiceSettingsHost()
  const settings = await host.load()
  await host.save({ ...settings, projectHotwords: { "/z": "last", "/a": "first" } })
  // Rust JSON objects return keys in sorted order, unlike the form's insertion order.
  fixture.changed({ "voice.projectHotwords": { "/a": "first", "/z": "last" } })
  await expect(host.save({ ...settings, projectHotwords: { "/z": "last", "/a": "first" } })).resolves.toBeUndefined()
})
