import { error as logError } from "@tauri-apps/plugin-log"
import { expect, test, vi } from "vitest"

import { describeProviderError, logProviderError } from "../provider-errors"

test("native error envelopes preserve nested messages and codes", () => {
  const error = { code: "runtime", message: "Request failed", data: { error: { message: "Not ready", code: -32603 } } }
  expect(describeProviderError(error)).toContain("Not ready")
  expect(describeProviderError(error)).toContain("-32603")
  expect(describeProviderError(error)).not.toContain("[object Object]")
})

test("provider diagnostics omit credentials and request payloads", () => {
  logProviderError("test", {
    message: "Rejected Bearer sk-secret-value",
    apiKey: "private-key",
    data: { headers: { Authorization: "private-key" }, body: "private request", reason: "Unauthorized" }
  })
  expect(logError).toHaveBeenLastCalledWith(expect.stringContaining("Unauthorized"))
  const logged = String(vi.mocked(logError).mock.calls.at(-1)?.[0])
  expect(logged).not.toContain("private")
  expect(logged).not.toContain("sk-secret")
})

test("Error instances, strings and cyclic native envelopes remain readable", () => {
  expect(describeProviderError("offline")).toBe("offline")
  expect(describeProviderError(new Error("offline"))).toContain("offline")
  const error: { cause?: unknown } = {}
  error.cause = error
  expect(describeProviderError(error)).toContain("circular")
})

test.each([
  "api_key=private-credential",
  'apiKey="private-credential with spaces"',
  '"access_token": "private-credential"',
  "refresh-token: 'private-credential with spaces'",
  "Authorization: Basic private-credential",
  "https://user:private-credential@example.test/v1",
  "https://example.test/v1?token=private-credential&model=test",
  "Basic private-credential"
])("provider message credentials are redacted before reaching the log: %s", (message) => {
  logProviderError("test", { code: "connection_failed", message: `Connection failed: ${message}` })
  const logged = String(vi.mocked(logError).mock.calls.at(-1)?.[0])
  expect(logged).toContain("Connection failed")
  expect(logged).toContain("connection_failed")
  expect(logged).not.toContain("private-credential")
})
