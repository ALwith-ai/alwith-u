import { beforeEach, expect, test, vi } from "vitest"

import { imageNavigation, openImagesForSession } from "../navigation"

const windowState = vi.hoisted(() => ({ label: "main", native: true, request: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => windowState.native }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: windowState.label }) }))
vi.mock("@/lib/chat-window", () => ({ requestChatSurface: windowState.request }))

beforeEach(() => {
  vi.clearAllMocks()
  windowState.label = "main"
  windowState.native = true
  imageNavigation.setState({ request: null })
  windowState.request.mockResolvedValue(null)
})

test("the main window opens the requested session's image page, including repeated requests", async () => {
  await openImagesForSession("source")
  await openImagesForSession("source")
  expect(imageNavigation.getState().request).toEqual({ sessionId: "source", revision: 2 })
  expect(windowState.request).not.toHaveBeenCalled()
})

test("a floating chat requests the main gallery instead of navigating an unmounted local page", async () => {
  windowState.label = "chat"
  await openImagesForSession("floating-source")
  expect(windowState.request).toHaveBeenCalledExactlyOnceWith("main", { type: "images", sessionId: "floating-source" })
  expect(imageNavigation.getState().request).toBeNull()
  windowState.request.mockRejectedValueOnce(new Error("Main window unavailable"))
  await expect(openImagesForSession("floating-source")).rejects.toThrow("Main window unavailable")
})
