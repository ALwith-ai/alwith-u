import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, expect, test } from "vitest"

import { createPlatformPetAssets } from "@/features/auth/pet-assets"

afterEach(clearMocks)

test("a failed save restores the store's memory before selection refresh and publishes no change", async () => {
  const data = new Map<string, unknown>([["vibemon.accounts", { pet: "old" }]])
  let fail = true
  let changes = 0
  // 命名存储(store_*)的内存替身:set 失败即什么都没写,和 Rust 侧语义一致。
  mockIPC((command, args) => {
    const { key, value } = args as { key: string; value: unknown }
    if (command === "plugin:alwith-module-store|store_entries") return Object.fromEntries(data)
    if (command === "plugin:alwith-module-store|store_set") {
      if (fail) throw new Error("Disk full")
      data.set(key, value)
      return null
    }
    if (command === "plugin:alwith-module-store|store_delete") {
      data.delete(key)
      return null
    }
    if (command === "plugin:event|listen") return 1
    return null
  })
  const host = createPlatformPetAssets()
  host.subscribeStorage(() => {
    changes++
  })
  try {
    await expect(host.storage.set("vibemon.accounts", { pet: "new" })).rejects.toThrow("Disk full")
    expect(await host.storage.get("vibemon.accounts")).toEqual({ pet: "old" })
    expect(changes).toBe(0)
    fail = false
    await host.storage.set("vibemon.accounts", { pet: "new" })
    expect(await host.storage.get("vibemon.accounts")).toEqual({ pet: "new" })
    expect(changes).toBe(1)
  } finally {
    host.dispose()
    await Promise.resolve()
  }
})

test("a later failed write preserves the preceding successful selection", async () => {
  const data = new Map<string, unknown>([["vibemon.accounts", { pet: "old" }]])
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
    if (command === "plugin:alwith-module-store|store_entries") return Object.fromEntries(data)
    if (command === "plugin:alwith-module-store|store_set") {
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
  const host = createPlatformPetAssets()
  try {
    const first = host.storage.set("vibemon.accounts", { pet: "first" })
    await started
    const second = host.storage.set("vibemon.accounts", { pet: "second" })
    expect(data.get("vibemon.accounts")).toEqual({ pet: "first" })
    release()
    await first
    await expect(second).rejects.toThrow("Disk full")
    expect(await host.storage.get("vibemon.accounts")).toEqual({ pet: "first" })
  } finally {
    release()
    host.dispose()
    await Promise.resolve()
  }
})
