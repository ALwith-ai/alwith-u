import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { mergeListeningPorts, useTerminalPorts } from "../ports"

const mocks = vi.hoisted(() => ({ read: vi.fn(), native: true, log: vi.fn() }))
vi.mock("@alwith/module-terminal/tauri", () => ({ terminalClient: { listeningPorts: mocks.read } }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.native }))
vi.mock("@/lib/background-errors", () => ({ logBackgroundError: mocks.log }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.native = true
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test("polls native session ports without a terminal view and removes stopped services", async () => {
  mocks.read.mockResolvedValue([
    { sessionId: "a", ports: [41001] },
    { sessionId: "b", ports: [41002] }
  ])
  const view = renderHook(() => useTerminalPorts(["b", "a", "a"]))
  await act(() => Promise.resolve())
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(["a", "b"])
  expect(view.result.current).toEqual({ a: [41001], b: [41002] })
  expect(mergeListeningPorts([41003, 41001], view.result.current.a)).toEqual([41001, 41003])
  mocks.read.mockResolvedValue([
    { sessionId: "a", ports: [] },
    { sessionId: "b", ports: [41002] }
  ])
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(view.result.current).toEqual({ a: [], b: [41002] })
  view.unmount()
  const calls = mocks.read.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.read).toHaveBeenCalledTimes(calls)
})

test("late responses cannot move ports into another conversation", async () => {
  let complete!: (value: { sessionId: string; ports: number[] }[]) => void
  const pending = new Promise<{ sessionId: string; ports: number[] }[]>((resolve) => {
    complete = resolve
  })
  mocks.read.mockReturnValueOnce(pending).mockResolvedValue([{ sessionId: "b", ports: [42002] }])
  const view = renderHook(({ ids }) => useTerminalPorts(ids), { initialProps: { ids: ["a"] } })
  view.rerender({ ids: ["b"] })
  await act(() => Promise.resolve())
  expect(view.result.current).toEqual({ b: [42002] })
  await act(() => {
    complete([{ sessionId: "a", ports: [42001] }])
    return pending
  })
  expect(view.result.current).toEqual({ b: [42002] })
})

test("failed scans are reported once until recovery and do not overlap", async () => {
  mocks.read.mockRejectedValue(new Error("PORT_SCAN_FAILED: denied"))
  const view = renderHook(() => useTerminalPorts(["a"]))
  await act(() => Promise.resolve())
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(mocks.log).toHaveBeenCalledOnce()
  mocks.read.mockResolvedValue([{ sessionId: "a", ports: [43001] }])
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(view.result.current).toEqual({ a: [43001] })
})

test("browser previews do not invoke the native port scanner", () => {
  mocks.native = false
  const view = renderHook(() => useTerminalPorts(["a"]))
  expect(mocks.read).not.toHaveBeenCalled()
  expect(view.result.current).toEqual({})
})
