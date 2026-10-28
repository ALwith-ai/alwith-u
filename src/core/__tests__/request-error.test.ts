import { RuntimeRequestError } from "@alwith/api"
import { expect, test } from "vitest"

import { explainRequestError } from "../request-error"

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
