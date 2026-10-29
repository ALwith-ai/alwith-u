import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

const refresh = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock("@/features/auth/store", () => ({ requestAccountProviderRefresh: refresh }))

import { ManagedProviderSection } from "../provider-section"

beforeAll(async () => {
  await initI18n("en")
})
beforeEach(() => {
  refresh.mockReset()
  refresh.mockResolvedValue()
})

test("entering the section refreshes account models without a permanent refresh button", async () => {
  const view = render(<ManagedProviderSection />)
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(view.queryByRole("button", { name: "Refresh account models" })).toBeNull()
  expect(view.queryByRole("button", { name: "Retry" })).toBeNull()
  view.rerender(<ManagedProviderSection />)
  expect(refresh).toHaveBeenCalledTimes(1)
})

test("a failed fetch exposes a retry that waits for the real refresh result", async () => {
  refresh.mockRejectedValueOnce(new Error("Model service unavailable"))
  const view = render(<ManagedProviderSection />)
  await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Model service unavailable"))
  let finish!: () => void
  refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(view.getByRole("button", { name: "Retry" }))
  expect(view.getByRole("button", { name: "Retry" })).toBeDisabled()
  expect(refresh).toHaveBeenCalledTimes(2)
  await act(async () => finish())
  expect(view.queryByRole("alert")).toBeNull()
  expect(view.queryByRole("button", { name: "Retry" })).toBeNull()
})

test("returning to the mounted settings page refreshes again", async () => {
  render(<ManagedProviderSection />)
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  fireEvent(window, new Event("focus"))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
})
