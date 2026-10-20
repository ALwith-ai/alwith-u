import { vi } from "vitest"

import { type SettingsSnapshot, settingsStore } from "../settings-store"
let revision = 0
/** Simulate only the native transport. Components use the real client projection and subscriptions. */
export function settingsFixture(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  const snapshot = (): SettingsSnapshot => ({
    revision: ++revision,
    values: Object.fromEntries(values),
    browserMigrated: true
  })
  settingsStore.accept(snapshot())
  const read = vi.spyOn(settingsStore, "read").mockImplementation(async () => {
    const next = snapshot()
    settingsStore.accept(next)
    return next
  })
  const write = vi.spyOn(settingsStore, "write").mockImplementation(async input => {
    for (const [key, value] of Object.entries(input.changes ?? {})) {
      if (value === null) values.delete(key)
      else values.set(key, value)
    }
    const next = snapshot()
    settingsStore.accept(next)
    return next
  })
  return {
    values,
    read,
    write,
    changed(changes: Record<string, unknown>) {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) values.delete(key)
        else values.set(key, value)
      }
      settingsStore.accept(snapshot())
    }
  }
}
