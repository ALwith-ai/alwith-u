import { cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

const ports = vi.hoisted(() => ({
  start: vi.fn(),
  refresh: vi.fn(),
  bundles: vi.fn(),
  ensure: vi.fn(),
  recover: vi.fn()
}))
vi.mock("@alwith/module-extension/tauri", () => ({
  createTauriExtensionRuntime: () => ({
    start: ports.start,
    refresh: ports.refresh,
    subscribe: () => () => {},
    snapshot: () => null,
    host: {}
  })
}))
vi.mock("@alwith/module-extension/react", () => ({ mountReact: vi.fn(), useHostSnapshot: () => ({}) }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }))
vi.mock("@/bindings", () => ({ commands: { extensionBundles: ports.bundles } }))
vi.mock("../bundled", () => ({ ensureBundledExtensions: ports.ensure }))
vi.mock("../capabilities", () => ({ createHostCapabilities: () => ({}) }))
vi.mock("../capabilities/common", () => ({ commonCapabilities: {} }))
vi.mock("../legacy/host", () => ({ createPluginHost: () => ({}), createLegacyHost: () => ({}) }))
vi.mock("../ui", () => ({}))
vi.mock("../startup-import-control", () => ({ refreshExtensions: ports.recover }))
vi.mock("@/features/drive/plugin-bridge", () => ({ bindDrivePluginData: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  ports.refresh.mockResolvedValue(undefined)
  ports.start.mockResolvedValue(undefined)
  ports.bundles.mockResolvedValue([])
  ports.ensure.mockResolvedValue(undefined)
  ports.recover.mockResolvedValue(undefined)
})
afterEach(cleanup)

test("window focus runs full recovery and unmount removes its listener", async () => {
  const { useExtensions } = await import("../use-extensions")
  const view = renderHook(() => useExtensions())
  await waitFor(() => expect(ports.ensure).toHaveBeenCalledOnce())
  fireEvent(window, new Event("focus"))
  expect(ports.recover).toHaveBeenCalledOnce()
  view.unmount()
  fireEvent(window, new Event("focus"))
  expect(ports.recover).toHaveBeenCalledOnce()
})

test.each(["service", "bundles"])(
  "host startup retries a failed %s and shares successful initialization",
  async (stage) => {
    const error = new Error("Startup unavailable")
    const failing = stage === "service" ? ports.start : ports.ensure
    failing.mockRejectedValueOnce(error)
    const { startExtensionRuntime } = await import("../runtime")
    await expect(startExtensionRuntime()).rejects.toBe(error)
    const first = startExtensionRuntime()
    expect(startExtensionRuntime()).toBe(first)
    await first
    expect(ports.start).toHaveBeenCalledTimes(2)
    expect(ports.ensure).toHaveBeenCalledTimes(stage === "service" ? 1 : 2)
    await startExtensionRuntime()
    expect(ports.start).toHaveBeenCalledTimes(2)
  }
)
