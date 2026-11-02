import { afterEach, expect, test, vi } from "vitest"

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock("@tauri-apps/plugin-log", () => log)

import { showStartupFailure, startupStep } from "../startup-step"

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  document.body.innerHTML = ""
  document.documentElement.style.visibility = ""
})

function logging(): void {
  for (const write of Object.values(log)) write.mockResolvedValue(undefined)
}

test("slow startup reports the pending stage without cancelling its eventual result", async () => {
  vi.useFakeTimers()
  logging()
  const work = Promise.withResolvers<string>()
  const result = startupStep("computer", () => work.promise)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(log.warn).toHaveBeenCalledWith("[startup] computer: still pending after 15000ms")
  work.resolve("ready")
  await expect(result).resolves.toBe("ready")
  expect(vi.getTimerCount()).toBe(0)
})

test("startup rejection retains its cause and leaves no pending timer", async () => {
  vi.useFakeTimers()
  logging()
  const failure = new Error("native request failed")
  await expect(startupStep("viewport", () => Promise.reject(failure))).rejects.toBe(failure)
  expect(log.error).toHaveBeenCalledWith("[startup] viewport: failed: native request failed")
  expect(vi.getTimerCount()).toBe(0)
})

test("fatal bootstrap failures replace the loader even before React and toasts mount", () => {
  document.body.innerHTML = '<div id="root"><span>Loading</span></div>'
  document.documentElement.style.visibility = "hidden"
  showStartupFailure(new Error("<script>failed</script>"))
  expect(document.getElementById("root")).toHaveTextContent("ALwith U startup failed: <script>failed</script>")
  expect(document.querySelector("script")).toBeNull()
  expect(document.documentElement.style.visibility).toBe("visible")
})
