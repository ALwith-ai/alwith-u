import { beforeEach, expect, test, vi } from "vitest"
import type { ExtensionRuntime } from "@alwith/module-extension/host"
const fixture = vi.hoisted(() => ({
  label: "settings",
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
  scan: vi.fn()
}))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: fixture.label }) }))
vi.mock("../runtime", () => ({ startExtensionRuntime: async () => fixture.runtime }))
vi.mock("../reload-window", () => ({
  requestMainReload: fixture.request,
  serveMainReload: async (handler: (id: string) => Promise<string>) => {
    fixture.handler = handler
    return () => {}
  }
}))
vi.mock("../install-service", () => ({ executeStagedInstall: fixture.install, executeReload: fixture.install }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))
vi.mock("@/bindings", () => ({
  commands: {
    extensionInboxScan: async () => ({ operationId: "startup", tasks: [], errors: [] }),
    extensionInboxScanExtension: fixture.scan,
    extensionInboxPrepare: async () => ({
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
})

test("settings never installs locally and returns only the main result", async () => {
  fixture.request.mockResolvedValue("updated")
  const { updateAndReloadExtension } = await import("../startup-import-control")
  expect(await updateAndReloadExtension(fixture.runtime as unknown as ExtensionRuntime, "notes")).toBe("updated")
  expect(fixture.request).toHaveBeenCalledWith("notes")
  expect(fixture.scan).not.toHaveBeenCalled()
  expect(fixture.install).not.toHaveBeenCalled()
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
