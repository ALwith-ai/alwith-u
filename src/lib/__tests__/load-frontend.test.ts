import { afterEach, expect, test, vi } from "vitest"

import { loadFrontend } from "../load-frontend"

const log = vi.hoisted(() => ({ error: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-log", () => log)

afterEach(() => {
  document.body.innerHTML = ""
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
  log.error.mockReset().mockResolvedValue(undefined)
  vi.restoreAllMocks()
})

test("module syntax failures retain the source stack and reach native logs before bootstrap", async () => {
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
  vi.spyOn(console, "error").mockImplementation(() => {})
  const failure = new SyntaxError("Unexpected token ':'")
  failure.stack = "SyntaxError: Unexpected token ':'\nhttp://localhost/broken.js:12:8"
  await loadFrontend(() => Promise.reject(failure))
  expect(document.getElementById("root")).toHaveTextContent("http://localhost/broken.js:12:8")
  expect(log.error).toHaveBeenCalledWith(expect.stringContaining(failure.stack))
})

test("logging failure preserves the original startup error", async () => {
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
  vi.spyOn(console, "error").mockImplementation(() => {})
  log.error.mockRejectedValue(new Error("Logger unavailable"))
  await loadFrontend(() => Promise.reject(new SyntaxError("Unexpected token ':'")))
  expect(document.getElementById("root")).toHaveTextContent("Unexpected token ':'")
})

test("module loading failures replace the startup screen before the application can install handlers", async () => {
  document.body.innerHTML = '<div id="root">Loading</div>'
  vi.spyOn(console, "error").mockImplementation(() => {})
  await loadFrontend(() => Promise.reject(new SyntaxError("Missing export <App>")))
  expect(document.getElementById("root")).toHaveTextContent("Missing export <App>")
  expect(document.querySelector("app")).toBeNull()
})

test("successful loading leaves application rendering untouched", async () => {
  document.body.innerHTML = '<div id="root">Ready</div>'
  await loadFrontend(async () => {})
  expect(document.getElementById("root")).toHaveTextContent("Ready")
})
