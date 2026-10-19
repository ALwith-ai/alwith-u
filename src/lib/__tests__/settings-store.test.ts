import { expect, test } from "vitest"
import { SettingsClient, type SettingsSnapshot } from "../settings-store"

test("a late read cannot overwrite a newer native change event", async () => {
  let reply!: (snapshot: SettingsSnapshot) => void
  const client = new SettingsClient(
    () =>
      new Promise(resolve => {
        reply = resolve
      })
  )
  const read = client.read()
  client.accept({ revision: 2, values: { "appearance.theme": "dark" }, browserMigrated: true })
  reply({ revision: 1, values: { "appearance.theme": "light" }, browserMigrated: true })
  await read
  expect(client.get("appearance.theme")).toBe("dark")
})
test("failed native writes do not change the visible settings or notify subscribers", async () => {
  const client = new SettingsClient(async () => {
    throw new Error("Disk full")
  })
  client.accept({ revision: 1, values: { "voice.enabled": true }, browserMigrated: true })
  let changed = false
  client.subscribe(() => {
    changed = true
  })
  await expect(client.write({ action: "update", changes: { "voice.enabled": false } })).rejects.toThrow("Disk full")
  expect(client.get("voice.enabled")).toBe(true)
  expect(changed).toBe(false)
})
test("native deletions and committed updates notify once, without duplicate reply notifications", () => {
  const client = new SettingsClient(async () => {
    throw new Error("Unexpected request")
  })
  client.accept({ revision: 1, values: { "editor.fontSize": 18 }, browserMigrated: true })
  const keys: string[][] = []
  client.subscribe(changes => keys.push(changes))
  const next = { revision: 2, values: {}, browserMigrated: true }
  client.accept(next)
  client.accept(next)
  expect(keys).toEqual([["editor.fontSize"]])
  expect(client.get("editor.fontSize")).toBeUndefined()
})
