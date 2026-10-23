import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { PhysicalPosition } from "@tauri-apps/api/window"
import { afterEach, expect, test, vi } from "vitest"

import i18n, { initI18n } from "@/lib/i18n"

import { createPetWindowClient, petWindowCall } from "../window-client"

const native = vi.hoisted(() => ({ onMoved: vi.fn() }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ onMoved: native.onMoved })
}))

afterEach(() => {
  clearMocks()
  native.onMoved.mockReset()
})

test("native window moves reach the shared drag controller without pointer events", async () => {
  const stop = vi.fn()
  const position = new PhysicalPosition(120, 240)
  native.onMoved.mockImplementationOnce((listener: Parameters<WebviewWindow["onMoved"]>[0]) => {
    return Promise.try(() => {
      listener({ event: "tauri://move", id: 1, payload: position })
      return stop
    })
  })
  const listener = vi.fn()
  const unsubscribe = await createPetWindowClient().moved(listener)
  expect(listener).toHaveBeenCalledWith(position)
  unsubscribe()
  expect(stop).toHaveBeenCalledTimes(1)
})

test("native context menus read the current language each time they open", async () => {
  const requests: unknown[] = []
  mockIPC((command, args) => {
    expect(command).toBe("vibemon_window")
    requests.push(args)
    return null
  })
  await initI18n("zh-CN")
  await petWindowCall("menu")
  await i18n.changeLanguage("en")
  await petWindowCall("menu")
  expect(requests).toEqual([
    { action: "menu", payload: { closeLabel: "叫回休息室" } },
    { action: "menu", payload: { closeLabel: "Return to lounge" } }
  ])
})
