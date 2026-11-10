import { afterEach, expect, test, vi } from "vitest"

import { loadFrontend } from "../load-frontend"

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
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
