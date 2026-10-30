import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { useLoungeDrop } from "../use-lounge-drop"

const f = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  visible: true,
  rect: { x: 100, y: 100, width: 100, height: 100 },
  request: vi.fn(async () => {}),
  error: vi.fn()
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: () => void) => {
    f.handlers.set(name, handler)
    return Promise.resolve(() => f.handlers.delete(name))
  }
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({}),
  WebviewWindow: {
    getByLabel: () =>
      Promise.resolve({
        outerPosition: () => Promise.resolve({ x: f.rect.x, y: f.rect.y }),
        outerSize: () => Promise.resolve({ width: f.rect.width, height: f.rect.height })
      })
  }
}))
vi.mock("@nyssance/atlas/station", async (original) => ({
  ...(await original<typeof import("@nyssance/atlas/station")>()),
  isStationFullyVisible: () => f.visible,
  readVisibleStation: () =>
    Promise.resolve({
      pane: { left: 0, top: 0, right: 300, bottom: 300 },
      nest: { left: 100, top: 100, right: 200, bottom: 200 }
    })
}))
vi.mock("../transport", () => ({ requestPet: f.request }))
vi.mock("../display-error", () => ({ reportPetError: f.error }))
afterEach(() => {
  cleanup()
  f.handlers.clear()
  f.request.mockClear()
  f.visible = true
  f.rect = { x: 100, y: 100, width: 100, height: 100 }
})

test("a native release returns a pet only when it covers the visible nest", async () => {
  renderHook(() => useLoungeDrop({ current: document.createElement("div") }))
  await act(() =>
    Promise.try(() => {
      f.handlers.get("vibemon:drag-end")?.()
    })
  )
  await waitFor(() => expect(f.request).toHaveBeenCalledExactlyOnceWith("close-pet"))
})

test.each(["hidden", "outside"])("a %s lounge cannot consume the desktop pet", async (reason) => {
  f.visible = reason !== "hidden"
  if (reason === "outside") f.rect.x = 250
  renderHook(() => useLoungeDrop({ current: document.createElement("div") }))
  await act(() =>
    Promise.try(() => {
      f.handlers.get("vibemon:drag-end")?.()
    })
  )
  expect(f.request).not.toHaveBeenCalled()
})

test("unmount invalidates an in-flight release", async () => {
  const view = renderHook(() => useLoungeDrop({ current: document.createElement("div") }))
  act(() => {
    f.handlers.get("vibemon:drag-end")?.()
    view.unmount()
  })
  await act(async () => {})
  expect(f.request).not.toHaveBeenCalled()
})
