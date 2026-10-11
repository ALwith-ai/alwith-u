import { afterEach, expect, test } from "vitest"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { createPlatformPetAssets } from "@/features/auth/pet-assets"

afterEach(clearMocks)

test("a failed save restores the store's memory before selection refresh and publishes no change", async () => {
  const data = new Map<string, unknown>([["vibemon.accounts", { pet: "old" }]])
  let fail = true
  let changes = 0
  mockIPC((command, args) => {
    const key = args.key as string
    if (command === "plugin:store|load") return 1
    if (command === "plugin:store|get") return [data.get(key), data.has(key)]
    if (command === "plugin:store|set") {
      data.set(key, args.value)
      return null
    }
    if (command === "plugin:store|delete") return data.delete(key)
    if (command === "plugin:store|save" && fail) throw new Error("Disk full")
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
  const firstSave = new Promise<void>(resolve => {
    release = resolve
  })
  const started = new Promise<void>(resolve => {
    saving = resolve
  })
  let saves = 0
  mockIPC(async (command, args) => {
    const key = args.key as string
    if (command === "plugin:store|load") return 1
    if (command === "plugin:store|get") return [data.get(key), data.has(key)]
    if (command === "plugin:store|set") {
      data.set(key, args.value)
      return null
    }
    if (command === "plugin:store|save") {
      if (++saves === 1) {
        saving()
        await firstSave
      } else throw new Error("Disk full")
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
