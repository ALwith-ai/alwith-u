import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, expect, test } from "vitest"

import { createPlatformVibemonAssets } from "@/features/auth/vibemon-assets"

afterEach(clearMocks)

test("a failed save restores the store's memory before selection refresh and publishes no change", async () => {
  const data = new Map<string, unknown>([["vibemon.accounts", { vibemon: "old" }]])
  let fail = true
  let changes = 0
  // A failed named-store write preserves both memory and disk state.
  mockIPC((command, args) => {
    const { key, value } = args as { key: string; value: unknown }
    if (command === "plugin:alwith-store|store_entries") return Object.fromEntries(data)
    if (command === "plugin:alwith-store|store_set") {
      if (fail) throw new Error("Disk full")
      data.set(key, value)
      return null
    }
    if (command === "plugin:alwith-store|store_delete") {
      data.delete(key)
      return null
    }
    if (command === "plugin:event|listen") return 1
    return null
  })
  const host = createPlatformVibemonAssets()
  host.subscribeStorage(() => {
    changes++
  })
  try {
    await expect(host.storage.set("vibemon.accounts", { vibemon: "new" })).rejects.toThrow("Disk full")
    expect(await host.storage.get("vibemon.accounts")).toEqual({ vibemon: "old" })
    expect(changes).toBe(0)
    fail = false
    await host.storage.set("vibemon.accounts", { vibemon: "new" })
    expect(await host.storage.get("vibemon.accounts")).toEqual({ vibemon: "new" })
    expect(changes).toBe(1)
  } finally {
    host.dispose()
    await Promise.resolve()
  }
})

test("a later failed write preserves the preceding successful selection", async () => {
  const data = new Map<string, unknown>([["vibemon.accounts", { vibemon: "old" }]])
  let release!: () => void
  let saving!: () => void
  const firstSave = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    saving = resolve
  })
  let saves = 0
  mockIPC(async (command, args) => {
    const { key, value } = args as { key: string; value: unknown }
    if (command === "plugin:alwith-store|store_entries") return Object.fromEntries(data)
    if (command === "plugin:alwith-store|store_set") {
      if (++saves === 1) {
        data.set(key, value)
        saving()
        await firstSave
      } else throw new Error("Disk full")
      return null
    }
    if (command === "plugin:event|listen") return 1
    return null
  })
  const host = createPlatformVibemonAssets()
  try {
    const first = host.storage.set("vibemon.accounts", { vibemon: "first" })
    await started
    const second = host.storage.set("vibemon.accounts", { vibemon: "second" })
    expect(data.get("vibemon.accounts")).toEqual({ vibemon: "first" })
    release()
    await first
    await expect(second).rejects.toThrow("Disk full")
    expect(await host.storage.get("vibemon.accounts")).toEqual({ vibemon: "first" })
  } finally {
    release()
    host.dispose()
    await Promise.resolve()
  }
})

test("legacy selections preserve account settings without overwriting newer choices or disk", async () => {
  const legacy = {
    first: { pet: "selected-old", enabled: true, position: { x: 12, y: 34 } },
    second: { pet: "stale", vibemon: "", enabled: false, position: null },
    third: { vibemon: "selected-new", enabled: true, position: null }
  }
  const writes: unknown[] = []
  mockIPC((command, args) => {
    if (command === "plugin:alwith-store|store_entries") return { "vibemon.accounts": legacy }
    if (command === "plugin:alwith-store|store_set") writes.push(args)
    if (command === "plugin:event|listen") return 1
    return null
  })
  const host = createPlatformVibemonAssets()
  try {
    expect(await host.storage.get("vibemon.accounts")).toEqual({
      ...legacy,
      first: { ...legacy.first, vibemon: "selected-old" }
    })
    expect(legacy.first).not.toHaveProperty("vibemon")
    expect(writes).toEqual([])
  } finally {
    host.dispose()
    await Promise.resolve()
  }
})
