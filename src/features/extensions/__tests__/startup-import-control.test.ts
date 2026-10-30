import type { ExtensionRuntime } from "@alwith/module-extension/host"
import { beforeEach, expect, test, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  label: "settings",
  start: vi.fn(),
  subscriptions: 0,
  handler: undefined as undefined | ((id: string) => Promise<string>),
  runtime: {
    refresh: vi.fn(),
    snapshot: () => ({
      native: { installations: [{ id: "notes", enabled: true, source: "local", packageRevision: "old" }], pending: [] }
    })
  },
  request: vi.fn(),
  install: vi.fn(),
  complete: vi.fn(),
  failed: vi.fn(),
  finish: vi.fn(),
  scan: vi.fn(),
  startupTasks: [] as string[]
}))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: fixture.label }) }))
vi.mock("../runtime", () => ({ startExtensionRuntime: fixture.start }))
vi.mock("../reload-window", () => ({
  requestMainReload: fixture.request,
  serveMainReload: (handler: (id: string) => Promise<string>) => {
    fixture.subscriptions++
    fixture.handler = handler
    return Promise.resolve(() => {})
  }
}))
vi.mock("../install-service", () => ({ executeStagedInstall: fixture.install, executeReload: fixture.install }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))
vi.mock("@/bindings", () => ({
  commands: {
    extensionInboxScan: () => Promise.resolve({ operationId: "startup", tasks: fixture.startupTasks, errors: [] }),
    extensionInboxScanExtension: fixture.scan,
    extensionInboxPrepare: () =>
      Promise.resolve({
        id: "task",
        phase: "prepared",
        package: { id: "notes", digest: "new", source: "local", path: "/package", version: "2" }
      }),
    extensionInboxComplete: fixture.complete,
    extensionInboxFailed: fixture.failed,
    extensionInboxFinish: fixture.finish
  }
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  fixture.label = "settings"
  fixture.startupTasks = []
  fixture.subscriptions = 0
  fixture.start.mockResolvedValue(fixture.runtime)
})

test("startup imports recover after service startup fails without duplicating the reload listener", async () => {
  fixture.label = "main"
  fixture.startupTasks = ["task"]
  fixture.install.mockResolvedValue({ error: null })
  fixture.start.mockRejectedValueOnce(new Error("Directory locked"))
  const { startStartupImports } = await import("../startup-import-control")
  await expect(startStartupImports()).rejects.toThrow("Directory locked")
  expect(fixture.install).not.toHaveBeenCalled()
  await Promise.all([startStartupImports(), startStartupImports()])
  expect(fixture.subscriptions).toBe(1)
  expect(fixture.install).toHaveBeenCalledOnce()
  expect(fixture.complete).toHaveBeenCalledWith({ taskId: "task", operationId: "startup" })
})

test("settings never installs locally and returns only the main result", async () => {
  fixture.request.mockResolvedValue("updated")
  const { updateAndReloadExtension } = await import("../startup-import-control")
  expect(await updateAndReloadExtension(fixture.runtime as unknown as ExtensionRuntime, "notes")).toBe("updated")
  expect(fixture.request).toHaveBeenCalledWith("notes")
  expect(fixture.scan).not.toHaveBeenCalled()
  expect(fixture.install).not.toHaveBeenCalled()
})

test("focus recovery completes failed startup imports before refreshing", async () => {
  fixture.label = "main"
  fixture.startupTasks = ["task"]
  fixture.install.mockResolvedValue({ error: null })
  fixture.start.mockRejectedValueOnce(new Error("Directory locked"))
  const { startStartupImports, refreshExtensions } = await import("../startup-import-control")
  await expect(startStartupImports()).rejects.toThrow("Directory locked")
  fixture.runtime.refresh.mockImplementation((): Promise<void> => {
    expect(fixture.complete).toHaveBeenCalledWith({ taskId: "task", operationId: "startup" })

    return Promise.resolve()
  })
  await refreshExtensions()
  expect(fixture.subscriptions).toBe(1)
  expect(fixture.install).toHaveBeenCalledOnce()
  expect(fixture.runtime.refresh).toHaveBeenCalledOnce()
  fixture.runtime.refresh.mockReset()
})

test("focus recovery does not refresh when startup is still unavailable", async () => {
  fixture.start.mockRejectedValueOnce(new Error("Subscription unavailable"))
  const { refreshExtensions } = await import("../startup-import-control")
  await expect(refreshExtensions()).rejects.toThrow("Subscription unavailable")
  expect(fixture.runtime.refresh).not.toHaveBeenCalled()
})

test("main activation failure retains the input and reports failure to settings", async () => {
  fixture.label = "main"
  fixture.scan.mockResolvedValue({ operationId: "manual", tasks: ["task"], errors: [] })
  fixture.install.mockResolvedValue({ error: { message: "Main activation failed" } })
  const { startStartupImports } = await import("../startup-import-control")
  await startStartupImports()
  expect(fixture.handler).toBeDefined()
  if (!fixture.handler) throw new Error("Main reload handler was not registered")
  await expect(fixture.handler("notes")).rejects.toThrow("Main activation failed")
  expect(fixture.complete).not.toHaveBeenCalled()
  expect(fixture.failed).toHaveBeenCalledWith({
    taskId: "task",
    operationId: "manual",
    message: "Main activation failed"
  })
  expect(fixture.finish).toHaveBeenLastCalledWith({ operationId: "manual" })
})

test("startup inbox uses the shared default enable policy", async () => {
  fixture.label = "main"
  fixture.startupTasks = ["task"]
  fixture.install.mockResolvedValue({ error: null })
  const { startStartupImports } = await import("../startup-import-control")
  await startStartupImports()
  expect(fixture.install).toHaveBeenCalledWith(
    fixture.runtime,
    expect.objectContaining({ id: "notes" }),
    { update: true },
    expect.any(AbortSignal)
  )
  expect(fixture.complete).toHaveBeenCalledWith({ taskId: "task", operationId: "startup" })
})
