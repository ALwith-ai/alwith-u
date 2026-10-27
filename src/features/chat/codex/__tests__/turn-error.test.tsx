import type { TurnError } from "@alwith/api"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { TurnErrorView } from "../turn-error"

await initI18n("en")
const error: TurnError = {
  stopReason: "error",
  error: {
    code: -32603,
    message: "Selected model is at capacity.",
    data: { codex: { category: "overloaded", retryable: true } }
  },
  meta: null
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test("automatically continues a capacity failure once after its countdown", async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue(undefined)
  const view = render(<TurnErrorView error={error} retry={{ turnId: "failed", delaySeconds: 10, run }} />)
  expect(view.getByRole("button", { name: "Retry in 10s" })).toBeEnabled()
  await act(() => {
    vi.advanceTimersByTime(10000)

    return Promise.resolve()
  })
  expect(run).toHaveBeenCalledExactlyOnceWith("automatic")
  await act(() => {
    vi.advanceTimersByTime(30000)

    return Promise.resolve()
  })
  expect(run).toHaveBeenCalledTimes(1)
  expect(view.getByRole("button")).toBeDisabled()
})

test("manual retry claims the same action before the countdown can submit it again", async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue(undefined)
  const view = render(<TurnErrorView error={error} retry={{ turnId: "failed", delaySeconds: 10, run }} />)
  fireEvent.click(view.getByRole("button"))
  fireEvent.click(view.getByRole("button"))
  await act(() => {
    vi.advanceTimersByTime(20000)

    return Promise.resolve()
  })
  expect(run).toHaveBeenCalledExactlyOnceWith("manual")
})

test("unmounting or losing eligibility cancels the countdown", async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockResolvedValue(undefined)
  const view = render(<TurnErrorView error={error} retry={{ turnId: "failed", delaySeconds: 10, run }} />)
  view.rerender(<TurnErrorView error={error} />)
  await act(() => {
    vi.advanceTimersByTime(20000)

    return Promise.resolve()
  })
  expect(run).not.toHaveBeenCalled()
  expect(view.queryByRole("button")).toBeNull()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test("a rejected retry keeps the original error, stops automatic submission and allows manual retry", async () => {
  vi.useFakeTimers()
  const run = vi.fn().mockRejectedValueOnce(new Error("Conversation is busy")).mockResolvedValue(undefined)
  const view = render(<TurnErrorView error={error} retry={{ turnId: "failed", delaySeconds: 10, run }} />)
  await act(() => {
    vi.advanceTimersByTime(10000)

    return Promise.resolve()
  })
  expect(view.getByText("Selected model is at capacity.")).toBeDefined()
  expect(view.getByText("Conversation is busy")).toBeDefined()
  expect(view.getByRole("button", { name: "Retry" })).toBeEnabled()
  await act(() => {
    vi.advanceTimersByTime(30000)

    return Promise.resolve()
  })
  expect(run).toHaveBeenCalledTimes(1)
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(run).toHaveBeenLastCalledWith("manual")
})
