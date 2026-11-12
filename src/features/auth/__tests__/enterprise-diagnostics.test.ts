import { error, info } from "@tauri-apps/plugin-log"
import { beforeEach, expect, test, vi } from "vitest"

import { logEnterpriseError, logEnterpriseResponse, traceEnterprise } from "../enterprise-diagnostics"

beforeEach(() => vi.clearAllMocks())
test("enterprise errors preserve nested rejection causes and correlation without browser proofs", () => {
  logEnterpriseError("browser-callback", {
    kind: "authorization",
    data: {
      status: 401,
      requestId: "request-1",
      cause: {
        code: "invalid_grant",
        message:
          "Rejected ticket=private-ticket state=private-state https://login.test/callback?code=private-code accessToken=private-token"
      },
      headers: { authorization: "private-header" }
    }
  })
  const logged = String(vi.mocked(error).mock.calls.at(-1)?.[0])
  for (const expected of ["browser-callback", "401", "request-1", "invalid_grant"]) expect(logged).toContain(expected)
  expect(logged).not.toContain("private-")
})
test("operation failures are traced and rethrown intact", async () => {
  const reason = { kind: "native_load", message: "Library unavailable" }
  await expect(traceEnterprise("begin-browser", () => Promise.reject(reason))).rejects.toBe(reason)
  expect(info).toHaveBeenCalledWith(expect.stringContaining("stage=begin-browser started"))
  expect(error).toHaveBeenCalledWith(
    expect.stringMatching(/enterprise\/begin-browser operation=.*elapsed_ms=.*native_load/)
  )
})

test("HTTP rejection diagnostics retain the response for authentication retry and include server correlation", async () => {
  const response = new Response(
    JSON.stringify({
      detail: "Enterprise authorization expired",
      error: { code: "invalid_grant" },
      access_token: "private-token"
    }),
    { status: 401, headers: { "x-request-id": "auth-request" } }
  )
  await logEnterpriseResponse("GET /api/v1/me/enterprise/finture", response)
  expect(await response.json()).toHaveProperty("access_token", "private-token")
  const logged = String(vi.mocked(error).mock.calls.at(-1)?.[0])
  for (const value of ["401", "auth-request", "invalid_grant", "Enterprise authorization expired"])
    expect(logged).toContain(value)
  expect(logged).not.toContain("private-token")
})
test("oversized and non-JSON HTTP errors preserve the status without logging raw payloads", async () => {
  await logEnterpriseResponse("status", new Response("private-content".repeat(2000), { status: 502 }))
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining("diagnostic limit"))
  await logEnterpriseResponse("status", new Response("private-content", { status: 503 }))
  expect(error).toHaveBeenLastCalledWith(expect.stringContaining("Non-JSON"))
  expect(String(vi.mocked(error).mock.calls)).not.toContain("private-content")
})
