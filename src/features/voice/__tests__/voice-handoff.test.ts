import { act, renderHook } from "@testing-library/react"
import { expect, test } from "vitest"

import { useVoiceHandoff } from "../use-voice-handoff"

test("the accepted voice receipt is consumed once by its own surface", () => {
  const { result } = renderHook(() => useVoiceHandoff("session", 0))
  act(() => result.current.accept("session", "receipt"))
  expect(result.current.resume?.receipt).toBe("receipt")
  act(() => result.current.resume?.consume())
  expect(result.current.resume).toBeUndefined()
})

test.each(["session", "generation"])("changing the %s discards pending voice resumption", (field) => {
  const { result, rerender } = renderHook(({ session, generation }) => useVoiceHandoff(session, generation), {
    initialProps: { session: "original", generation: 0 }
  })
  act(() => result.current.accept("original", "receipt"))
  expect(result.current.resume?.receipt).toBe("receipt")
  rerender({ session: field === "session" ? "another" : "original", generation: field === "generation" ? 1 : 0 })
  expect(result.current.resume).toBeUndefined()
  rerender({ session: "original", generation: 0 })
  expect(result.current.resume).toBeUndefined()
})
