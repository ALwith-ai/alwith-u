import { RuntimeRequestError } from "@alwith/api"
import { expect, test } from "vitest"

import { explainRequestError, isAuthenticationRequired, isModelSelectionRequired } from "../request-error"

test.each([
  [new Error("The selected provider connection or model is unavailable"), true],
  [new Error("The selected model connection is unavailable. Select another model before sending."), true],
  [
    new RuntimeRequestError("acpRequest", {
      code: -32602,
      message: "Invalid params",
      data: { details: "The selected provider connection or model is unavailable" }
    }),
    true
  ],
  [new Error("The selected ALwith account model is unavailable. Select another model before sending."), true],
  [new Error("The ALwith account changed. Select a model before sending"), true],
  [new Error("Invalid params: unknown config option"), false],
  [new Error("Connection lost"), false],
  [null, false]
])("model recovery distinguishes route errors from other request failures: %j", (error, expected) => {
  expect(isModelSelectionRequired(error)).toBe(expected)
})

test.each([
  [{ code: -32000, message: "Authentication required" }, true],
  [new RuntimeRequestError("acpRequest", { code: -32000, message: "Authentication required: Sign in again" }), true],
  [new RuntimeRequestError("acpRequest", { code: -32000, message: "agent codex exited" }), false],
  [{ code: -32603, message: "Authentication required" }, false],
  [new Error("Authentication required"), false],
  [null, false]
])("only ACP authentication failures request login: %j", (error, expected) => {
  expect(isAuthenticationRequired(error)).toBe(expected)
})

test.each([
  "invalid MCP config: EOF while parsing a value",
  { details: "invalid MCP config: EOF while parsing a value" }
])("agent details stay actionable without losing error codes and payloads: %s", (data) => {
  const error = new RuntimeRequestError("acpRequest", {
    code: -32603,
    message: "Internal error",
    data
  })
  expect(explainRequestError(error, "_codex/import/detect")).toBe(error)
  expect(error.message).toBe("_codex/import/detect: invalid MCP config: EOF while parsing a value")
  expect(error.code).toBe(-32603)
  expect(error.reason).toBe("Internal error")
})

test("errors without agent details retain their original identity and message", () => {
  const error = new Error("Connection lost")
  expect(explainRequestError(error, "session/new")).toBe(error)
  expect(error.message).toBe("Connection lost")
})
