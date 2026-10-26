import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

const request = vi.hoisted(() => vi.fn())
vi.mock("@/features/auth/store", () => ({ platformApiRequest: request }))
import { PhoneLoginView } from "../phone-login-view"

beforeAll(() => initI18n("en"))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

test("requires explicit confirmation after scanning and uses authenticated platform transport", async () => {
  vi.useFakeTimers()
  request.mockImplementation(async (path: string) => {
    if (path.endsWith("/status")) return { status: "SCANNED", device_id: "phone-123", device_name: "Test iPhone" }
    if (path.endsWith("/confirm")) return undefined
    return { qr_ticket: "ticket", qr_content: "alwith://mobile-login?ticket=ticket", expires_in: 120 }
  })
  const continuePairing = vi.fn()
  render(<PhoneLoginView onBack={() => {}} onContinue={continuePairing} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(request).toHaveBeenCalledWith("/api/v1/auth/qr/mobile-tickets", "POST", undefined)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  expect(screen.getByText("Test iPhone")).toBeVisible()
  expect(request.mock.calls.some(([path]) => path.endsWith("/confirm"))).toBe(false)
  fireEvent.click(screen.getByRole("button", { name: "Confirm sign-in" }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(request).toHaveBeenCalledWith("/api/v1/auth/qr/mobile-tickets/confirm", "POST", { qr_ticket: "ticket" })
  expect(screen.getByText("Phone sign-in approved")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Continue to pair with this U" }))
  expect(continuePairing).toHaveBeenCalledOnce()
})
