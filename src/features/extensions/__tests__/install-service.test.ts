import { expect, test } from "bun:test"
import { parseManifest } from "@alwith/module-extension"
import type { HostSnapshot, RuntimeSnapshot } from "@alwith/module-extension/host"
import type { Request } from "@alwith/module-extension/tauri"
import { executePreparedInstall } from "../install-service"

const manifest = parseManifest({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  dependencies: { "@alwith/module-extension": "^0.1.0" }
})
const selected = { format: "current" as const, id: "notes", version: "1.0.0", digest: "new", path: "/source" }

function boundary(existing = false, source = "local") {
  const listeners = new Set<() => void>()
  const hostListeners = new Set<() => void>()
  const host: HostSnapshot = { actions: [], commands: [], views: [], instances: [] }
  const state: RuntimeSnapshot = {
    busy: false,
    errors: {},
    native: {
      protocolVersion: 1,
      serviceId: "test",
      sequence: 0,
      pending: [],
      installations: existing
        ? [
            {
              id: "notes",
              source,
              enabled: false,
              installationId: "identity",
              packageRevision: "old",
              dataGeneration: 1,
              manifest
            }
          ]
        : []
    }
  }
  let writes = 0
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const runtime = {
    snapshot: (): RuntimeSnapshot => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    host: {
      snapshot: (): HostSnapshot => host,
      subscribe: (listener: () => void): (() => void) => {
        hostListeners.add(listener)
        return () => {
          hostListeners.delete(listener)
        }
      }
    },
    settled: async (): Promise<void> => {},
    request: async (request: Request): Promise<void> => {
      writes++
      if (!state.native) throw new Error("Missing state")
      if (request.type === "installLocal")
        state.native.installations = [
          {
            id: "notes",
            source: request.source,
            enabled: false,
            installationId: "identity",
            packageRevision: request.expectedDigest ?? "missing",
            dataGeneration: 1,
            manifest
          }
        ]
      if (request.type === "beginTransition")
        state.native.pending = [{ id: request.id, action: "update", waitingInstances: 1 }]
      if (request.type === "enable") {
        const installed = state.native.installations[0]
        if (!installed) throw new Error("Missing installation")
        installed.enabled = true
        host.instances = [{ id: "notes", revision: "new", status: "active", errors: [] }]
      }
      notify()
    }
  }
  return {
    runtime,
    state,
    host,
    writes: () => writes,
    commit: (digest = "new"): void => {
      if (!state.native) throw new Error("Missing state")
      state.native.pending = []
      const installed = state.native.installations[0]
      if (!installed) throw new Error("Missing installation")
      installed.packageRevision = digest
      notify()
    }
  }
}

test("a fresh install commits the selected package before enabling", async () => {
  const item = boundary()
  const result = await executePreparedInstall(item.runtime, selected, { update: false, enable: true })
  expect(result).toMatchObject({
    id: "notes",
    installed: true,
    enabled: true,
    activeInMainWindow: true,
    packageRevision: "new"
  })
  expect(item.state.native?.installations[0]?.packageRevision).toBe("new")
})

test("duplicate install and source conflict preserve the existing installation", async () => {
  for (const [source, update] of [
    ["local", false],
    ["legacy:alwith-u", true]
  ] as const) {
    const item = boundary(true, source)
    await expect(executePreparedInstall(item.runtime, selected, { update, enable: false })).rejects.toThrow()
    expect(item.writes()).toBe(0)
    expect(item.state.native?.installations[0]?.packageRevision).toBe("old")
  }
})

test("update waits for another window and rejects an aborted transition", async () => {
  const item = boundary(true)
  let complete = false
  const operation = executePreparedInstall(item.runtime, selected, { update: true, enable: false }).then(result => {
    complete = true
    return result
  })
  await Bun.sleep(0)
  expect(complete).toBe(false)
  item.commit()
  expect((await operation).packageRevision).toBe("new")

  const aborted = boundary(true)
  const rejected = executePreparedInstall(aborted.runtime, selected, { update: true, enable: false })
  await Bun.sleep(0)
  aborted.commit("old")
  await expect(rejected).rejects.toThrow()
})

test("activation failure reports the committed installation instead of claiming success", async () => {
  const item = boundary()
  item.runtime.request = async request => {
    if (!item.state.native) throw new Error("Missing state")
    if (request.type === "installLocal")
      item.state.native.installations = [
        {
          id: "notes",
          source: "local",
          enabled: false,
          installationId: "identity",
          packageRevision: "new",
          dataGeneration: 1,
          manifest
        }
      ]
    if (request.type === "enable") {
      const installed = item.state.native.installations[0]
      if (!installed) throw new Error("Missing installation")
      installed.enabled = true
      item.state.errors.notes = "broken activation"
    }
  }
  const result = await executePreparedInstall(item.runtime, selected, { update: false, enable: true })
  expect(result).toMatchObject({
    installed: true,
    enabled: true,
    activeInMainWindow: false,
    error: { code: "activationFailed", message: "broken activation" }
  })
})

test("a package replaced while activation settles cannot be reported as the selected installation", async () => {
  const item = boundary()
  item.runtime.settled = async () => {
    const installed = item.state.native?.installations[0]
    if (!installed) throw new Error("Missing installation")
    installed.packageRevision = "another-package"
  }
  await expect(executePreparedInstall(item.runtime, selected, { update: false, enable: false })).rejects.toThrow()
})
