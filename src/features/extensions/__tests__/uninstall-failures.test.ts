import { expect, test } from "bun:test"
import type { ExtensionRuntime, RuntimeSnapshot } from "@alwith/module-extension/host"
import { executeUninstall } from "../uninstall-service"
import { watchUninstallFailures } from "../uninstall-failures"

function fixture() {
  const state: RuntimeSnapshot = {
    native: { serviceId: "test", protocolVersion: 1, sequence: 0, installations: [], pending: [] },
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
    state,
    runtime,
    notify: () => {
      for (const listener of listeners) listener()
    }
  }
}

test("a release error from another window ends waiting and preserves native state", async () => {
  const main = fixture()
  const settings = fixture()
  for (const item of [main, settings]) {
    if (!item.state.native) throw new Error("Missing state")
    item.state.native.pending = [{ id: "notes", action: "uninstall", waitingInstances: 1 }]
  }
  const listeners = new Set<(failure: { id: string; error: string }) => void>()
  const events = {
    listen: async (listener: (failure: { id: string; error: string }) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: async (failure: { id: string; error: string }) => {
      for (const listener of listeners) listener(failure)
    },
    report: (error: unknown) => {
      throw error
    }
  }
  const mainFailures = await watchUninstallFailures(main.runtime, events)
  const settingsFailures = await watchUninstallFailures(settings.runtime, events)
  const uninstall = executeUninstall(main.runtime, "notes", mainFailures)
  settings.state.errors.notes = "Settings cleanup failed"
  settings.notify()
  await expect(uninstall).rejects.toThrow("Settings cleanup failed")
  expect(main.state.errors).toEqual({})
  expect(main.state.native?.pending).toHaveLength(1)
  expect((await executeUninstall(main.runtime, "other", mainFailures)).installed).toBe(false)
  if (!main.state.native) throw new Error("Missing state")
  main.state.native.pending = []
  main.notify()
  expect(mainFailures.error("notes")).toBeUndefined()
  mainFailures.dispose()
  settingsFailures.dispose()
  expect(listeners.size).toBe(0)
})

test("an existing activation error is not reported as a new release failure", async () => {
  const item = fixture()
  item.state.errors.notes = "Activation failed"
  const emitted: string[] = []
  const failures = await watchUninstallFailures(item.runtime, {
    listen: async () => () => {},
    emit: async event => {
      emitted.push(event.error)
    },
    report: error => {
      throw error
    }
  })
  if (!item.state.native) throw new Error("Missing state")
  item.state.native.pending = [{ id: "notes", action: "uninstall", waitingInstances: 1 }]
  item.notify()
  expect(emitted).toEqual([])
  failures.dispose()
})
