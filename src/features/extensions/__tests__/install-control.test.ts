import { afterEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({ platform: "windows", label: "main", completed: [] as string[] }))
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => host.platform }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: host.label }) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: { requestId: string }) => {
    if (command === "extension_control_status") return
    if (command === "extension_control_next") {
      if (host.completed.length) return null
      return { operation: "uninstall", requestId: "request", id: "notes" }
    }
    if (command === "extension_control_complete" && args) {
      host.completed.push(args.requestId)
      return
    }
    throw new Error(`Unexpected command ${command}`)
  }
}))
vi.mock("../runtime", () => ({
  startExtensionRuntime: async () => ({}),
  getUninstallFailures: () => new Map(),
  reportExtensionError: (error: unknown) => {
    throw error
  }
}))
vi.mock("../uninstall-service", () => ({ executeUninstall: async () => ({ installed: false }) }))
vi.mock("../install-service", () => ({
  executePreparedInstall: async () => {
    throw new Error("Unexpected install")
  }
}))

afterEach(() => {
  vi.useRealTimers()
  host.completed = []
})

test.each(["windows", "macos"])("%s main window drains CLI uninstall requests", async platform => {
  vi.useFakeTimers()
  host.platform = platform
  host.label = "main"
  const { startExtensionInstallControl } = await import("../install-control")
  await startExtensionInstallControl()
  await vi.advanceTimersByTimeAsync(0)
  expect(host.completed).toEqual(["request"])
})

test.each([
  ["windows", "chat"],
  ["linux", "main"]
])("%s %s does not consume CLI requests", async (platform, label) => {
  vi.useFakeTimers()
  host.platform = platform
  host.label = label
  const { startExtensionInstallControl } = await import("../install-control")
  await startExtensionInstallControl()
  await vi.advanceTimersByTimeAsync(0)
  expect(host.completed).toEqual([])
})
