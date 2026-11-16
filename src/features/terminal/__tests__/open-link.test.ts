import { expect, test, vi } from "vitest"

import { openTerminalLink } from "../open-link"
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), invoke: vi.fn(), external: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@/lib/runtime-capabilities", () => ({ runtimeCapabilities: mocks.capabilities }))
vi.mock("@/lib/open", () => ({ openExternal: mocks.external }))
test("CEF opens a session-bound live guest while Wry uses the explicit external browser action", async () => {
  mocks.capabilities.mockResolvedValueOnce({ embeddedBrowser: true })
  await openTerminalLink("a", "http://localhost:3000")
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("cef_browser_open_url", {
    sessionId: "a",
    url: "http://localhost:3000"
  })
  mocks.capabilities.mockResolvedValueOnce({ embeddedBrowser: false })
  await openTerminalLink("b", "http://localhost:4000")
  expect(mocks.external).toHaveBeenCalledExactlyOnceWith("http://localhost:4000")
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})
