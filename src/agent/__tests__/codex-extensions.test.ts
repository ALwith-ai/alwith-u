import { expect, test } from "vitest"
import { codexTurnError } from "../codex-extensions"

test("standard errors preserve the message and Codex retry classification", () => {
  expect(
    codexTurnError({
      stopReason: "error",
      error: {
        code: -32603,
        message: "Provider unavailable",
        data: { codex: { category: "server", retryable: true } }
      },
      meta: { codex: { error: { message: "Old message" } } }
    })
  ).toEqual({
    message: "Provider unavailable",
    category: "server",
    retryable: true
  })
})

test("standard errors work without vendor metadata", () => {
  expect(codexTurnError({ stopReason: "error", error: { code: -32603, message: "Disconnected" }, meta: null })).toEqual(
    {
      message: "Disconnected",
      category: null,
      retryable: false
    }
  )
})

test("legacy errors and stop reasons without details remain visible", () => {
  expect(
    codexTurnError({ stopReason: "_error", error: null, meta: { codex: { error: { message: "Legacy failure" } } } })
      .message
  ).toBe("Legacy failure")
  expect(codexTurnError({ stopReason: "max_turn_requests", error: null, meta: null }).message).toBe(
    "Turn ended: max_turn_requests"
  )
})
