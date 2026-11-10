import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { AuthGate } from "../auth-gate"
import { authClient } from "../store"

vi.mock("../store", () => ({
  authClient: { sendVerificationCode: vi.fn().mockResolvedValue(undefined) },
  loginPlatform: vi.fn(),
  usePlatformAuth: (select: (state: { isAuthenticated: boolean; isLoading: boolean }) => unknown) =>
    select({ isAuthenticated: false, isLoading: false })
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

test("verification cooldown starts at 60 seconds for initial sends and resends", async () => {
  await initI18n("en")
  vi.useFakeTimers()
  const start = 1_800_000_000_000
  let clock = start
  vi.spyOn(Date, "now").mockImplementation(() => clock++)
  render(
    <StrictMode>
      <AuthGate>
        <div>Signed in</div>
      </AuthGate>
    </StrictMode>
  )
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.test" } })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send code" }))
  })
  expect(authClient.sendVerificationCode).toHaveBeenCalledWith("user@example.test", "LOGIN")
  expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled()
  clock += 1000
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(screen.getByRole("button", { name: "Resend in 59s" })).toBeDisabled()
  clock += 60_000
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send code" }))
  })
  expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled()
})
