import { parseManifest } from "@alwith/module-extension"
import type { HostSnapshot, RuntimeSnapshot } from "@alwith/module-extension/host"
import type { Request } from "@alwith/module-extension/tauri"
import { expect, test } from "vitest"

import { executePreparedInstall, executeReload, executeStagedInstall } from "../install-service"

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
    request: (request: Request): Promise<void> => {
      return Promise.try(() => {
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
          state.native.pending = [{ id: request.id, action: request.action, waitingInstances: 1 }]
        if (request.type === "enable") {
          const installed = state.native.installations[0]
          if (!installed) throw new Error("Missing installation")
          installed.enabled = true
          host.instances = [{ id: "notes", revision: "new", status: "active", errors: [] }]
        }
        notify()
      })
    }
  }
  return {
    runtime,
    state,
    host,
    writes: () => writes,
    commit: (digest = "new", activationRevision?: number): void => {
      if (!state.native) throw new Error("Missing state")
      state.native.pending = []
      const installed = state.native.installations[0]
      if (!installed) throw new Error("Missing installation")
      installed.packageRevision = digest
      if (activationRevision !== undefined) installed.activationRevision = activationRevision
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
  const operation = executePreparedInstall(item.runtime, selected, { update: true, enable: false }).then((result) => {
    complete = true
    return result
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(complete).toBe(false)
  item.commit()
  expect((await operation).packageRevision).toBe("new")

  const aborted = boundary(true)
  const rejected = executePreparedInstall(aborted.runtime, selected, { update: true, enable: false })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  aborted.commit("old")
  await expect(rejected).rejects.toThrow()
})

test("activation failure reports the committed installation instead of claiming success", async () => {
  const item = boundary()
  item.runtime.request = (request) => {
    return Promise.try(() => {
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
    })
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
  item.runtime.settled = () => {
    return Promise.try(() => {
      const installed = item.state.native?.installations[0]
      if (!installed) throw new Error("Missing installation")
      installed.packageRevision = "another-package"
    })
  }
  await expect(executePreparedInstall(item.runtime, selected, { update: false, enable: false })).rejects.toThrow()
})

test("startup installs remain disabled and matching packages are not reinstalled", async () => {
  const item = boundary()
  const staged = { ...selected, source: "local" }
  const first = await executeStagedInstall(item.runtime, staged, { update: true, enable: false })
  expect(first.enabled).toBe(false)
  expect(first.error).toBeNull()
  expect(item.writes()).toBe(1)
  await executeStagedInstall(item.runtime, staged, { update: true, enable: false })
  expect(item.writes()).toBe(1)
})

test("aborting a cross-window wait releases subscriptions without enabling later", async () => {
  const item = boundary(true)
  const controller = new AbortController()
  const operation = executeStagedInstall(
    item.runtime,
    { ...selected, source: "local" },
    { update: true, enable: true },
    controller.signal
  )
  const rejected = expect(operation).rejects.toThrow("deadline")
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  controller.abort(new Error("deadline"))
  await rejected
  item.commit()
  expect(item.state.native?.installations[0]?.enabled).toBe(false)
  expect(item.writes()).toBe(1)
})

test("startup updates preserve an enabled installation and check activation", async () => {
  const item = boundary(true)
  const installed = item.state.native?.installations[0]
  if (!installed) throw new Error("Missing fixture installation")
  installed.enabled = true
  const operation = executeStagedInstall(
    item.runtime,
    { ...selected, source: "local" },
    { update: true, enable: false }
  )
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  item.host.instances = [{ id: "notes", revision: "new", status: "active", errors: [] }]
  item.commit()
  expect(await operation).toMatchObject({ enabled: true, activeInMainWindow: true, error: null })
  expect(item.writes()).toBe(1)
})

test("reload waits for all leases, preserves enable intent and verifies activation revision", async () => {
  const item = boundary(true)
  const installed = item.state.native?.installations[0]
  if (!installed) throw new Error("Missing fixture installation")
  installed.enabled = true
  const operation = executeReload(item.runtime, "notes", new AbortController().signal)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(item.state.native?.pending[0]?.action).toBe("reload")
  expect(installed.enabled).toBe(true)
  item.host.instances = [{ id: "notes", revision: "old", status: "active", errors: [] }]
  item.commit("old", 1)
  expect(await operation).toMatchObject({ enabled: true, packageRevision: "old", error: null })
  expect(item.writes()).toBe(1)
})

test("a canceled reload cannot report the old active instance as a successful reload", async () => {
  const item = boundary(true)
  const installed = item.state.native?.installations[0]
  if (!installed) throw new Error("Missing fixture installation")
  installed.enabled = true
  item.host.instances = [{ id: "notes", revision: "old", status: "active", errors: [] }]
  const operation = executeReload(item.runtime, "notes", new AbortController().signal)
  const rejected = expect(operation).rejects.toThrow("reload did not commit")
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  item.commit("old")
  await rejected
})

test("folder installs enable fresh modern packages by default", async () => {
  const item = boundary()
  const result = await executePreparedInstall(item.runtime, selected, { update: false })
  expect(result).toMatchObject({ installed: true, enabled: true, activeInMainWindow: true, error: null })
  expect(item.writes()).toBe(2)
})

test("inbox installs enable fresh staged packages by default", async () => {
  const item = boundary()
  const result = await executeStagedInstall(item.runtime, { ...selected, source: "local" }, { update: true })
  expect(result).toMatchObject({ enabled: true, activeInMainWindow: true, error: null })
  expect(item.writes()).toBe(2)
})

for (const enabled of [false, true]) {
  test(`updates preserve existing enabled=${enabled} and installation configuration identity`, async () => {
    const item = boundary(true)
    const installed = item.state.native?.installations[0]
    if (!installed) throw new Error("Missing fixture installation")
    installed.enabled = enabled
    const previous = { installationId: installed.installationId, dataGeneration: installed.dataGeneration }
    const operation = executeStagedInstall(item.runtime, { ...selected, source: "local" }, { update: true })
    if (enabled) item.host.instances = [{ id: "notes", revision: "new", status: "active", errors: [] }]
    item.commit()
    expect(await operation).toMatchObject({ enabled, error: null })
    expect(item.state.native?.installations[0]).toMatchObject({ ...previous, enabled })
    expect(item.writes()).toBe(1)
  })
}
