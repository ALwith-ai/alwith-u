import { expect, test } from "bun:test"
import type { ExtensionRuntime, RuntimeSnapshot } from "@alwith/module-extension/host"
import { executeUninstall } from "../uninstall-service"

function fixture() {
  const state: RuntimeSnapshot = {
    native: { protocolVersion: 1, serviceId: "test", sequence: 0, installations: [], pending: [] },
    busy: false,
    errors: {}
  }
  const listeners = new Set<() => void>()
  const runtime: Pick<ExtensionRuntime, "snapshot" | "subscribe" | "request" | "settled"> = {
    snapshot: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    request: async () => {},
    settled: async () => {}
  }
  return {
    runtime,
    state,
    notify: () => {
      for (const listener of listeners) listener()
    }
  }
}

test("uninstall of an absent extension is idempotent", async () => {
  const item = fixture()
  const result = await executeUninstall(item.runtime, "notes")
  expect(result).toMatchObject({ id: "notes", installed: false, enabled: false, error: null })
})

test("uninstall waits for the old instances and rejects an aborted transition", async () => {
  const item = fixture()
  if (!item.state.native) throw new Error("Missing state")
  item.state.native.installations = [
    {
      id: "notes",
      manifest: {
        id: "notes",
        name: "Notes",
        version: "1.0.0",
        manifestVersion: 3,
        entry: "main.js",
        dependencies: {},
        hosts: {},
        dataSchemaVersion: 1
      },
      enabled: true,
      source: "local",
      installationId: "identity",
      packageRevision: "old",
      dataGeneration: 1
    }
  ]
  item.runtime.request = async () => {
    if (!item.state.native) throw new Error("Missing state")
    item.state.native.pending = [{ id: "notes", action: "uninstall", waitingInstances: 1 }]
  }
  let completed = false
  const result = executeUninstall(item.runtime, "notes").finally(() => {
    completed = true
  })
  await Promise.resolve()
  expect(completed).toBe(false)
  item.state.native.pending = []
  item.notify()
  await expect(result).rejects.toThrow("卸载未完成")
})

test("uninstall waits until the final lease is released", async () => {
  const item = fixture()
  const native = item.state.native
  if (!native) throw new Error("Missing state")
  native.pending = [{ id: "notes", action: "uninstall", waitingInstances: 1 }]
  let completed = false
  const result = executeUninstall(item.runtime, "notes").then(value => {
    completed = true
    return value
  })
  await Promise.resolve()
  expect(completed).toBe(false)
  native.pending = []
  item.notify()
  expect((await result).installed).toBe(false)
  expect(completed).toBe(true)
})

test("uninstall refuses an update already in progress", async () => {
  const item = fixture()
  if (!item.state.native) throw new Error("Missing state")
  item.state.native.pending = [{ id: "notes", action: "update", waitingInstances: 1 }]
  await expect(executeUninstall(item.runtime, "notes")).rejects.toThrow("transitioning")
})

test("uninstall rejects a new transition before final completion", async () => {
  const item = fixture()
  item.runtime.settled = async () => {
    if (!item.state.native) throw new Error("Missing state")
    item.state.native.pending = [{ id: "notes", action: "update", waitingInstances: 0 }]
  }
  await expect(executeUninstall(item.runtime, "notes")).rejects.toThrow("state changed")
})

test("uninstall reports a failed release instead of blocking the request queue", async () => {
  const item = fixture()
  if (!item.state.native) throw new Error("Missing state")
  item.state.native.pending = [{ id: "notes", action: "uninstall", waitingInstances: 1 }]
  item.state.errors.notes = "Cleanup failed"
  await expect(executeUninstall(item.runtime, "notes")).rejects.toThrow("Cleanup failed")
  expect(item.state.native.pending).toHaveLength(1)
})
