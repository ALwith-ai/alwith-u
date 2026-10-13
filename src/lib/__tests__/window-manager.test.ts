import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow"

const host = vi.hoisted(() => ({
  mac: false,
  existing: false,
  create: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  attach: vi.fn(),
  emit: vi.fn()
}))
vi.mock("../platform", () => ({ isMac: () => host.mac }))
vi.mock("../i18n", () => ({ default: { t: () => "Settings" } }))
vi.mock("@/bindings", () => ({ commands: { attachWindowToMain: host.attach } }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: host.emit }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    constructor(label: string, options: ConstructorParameters<typeof WebviewWindow>[1]) {
      host.create(label, options)
    }
    static async getByLabel() {
      return host.existing ? { show: host.show, setFocus: host.focus } : null
    }
    async once() {}
  }
}))
import { openSettingsWindow } from "../window-manager"

beforeEach(() => {
  vi.clearAllMocks()
  host.mac = false
  host.existing = false
  document.documentElement.style.setProperty("--background", "white")
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) })
  } as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty("--background")
})

test("Windows settings retains native window decorations", async () => {
  await openSettingsWindow("general")
  expect(host.create).toHaveBeenCalledWith(
    "settings",
    expect.objectContaining({
      url: "/settings.html?tab=general",
      resizable: false,
      maximizable: false,
      minimizable: false
    })
  )
  expect(host.create.mock.calls[0]?.[1].decorations).not.toBe(false)
})

test("macOS settings retains its overlay title bar and starts hidden for native attachment", async () => {
  host.mac = true
  await openSettingsWindow()
  expect(host.create).toHaveBeenCalledWith(
    "settings",
    expect.objectContaining({
      hiddenTitle: true,
      titleBarStyle: "overlay",
      visible: false
    })
  )
})

test("reopening hidden Windows settings reuses the window and selects the requested tab", async () => {
  host.existing = true
  await openSettingsWindow("appearance")
  expect(host.create).not.toHaveBeenCalled()
  expect(host.show).toHaveBeenCalledOnce()
  expect(host.focus).toHaveBeenCalledOnce()
  expect(host.emit).toHaveBeenCalledWith("settings", "settings-change-tab", "appearance")
})
