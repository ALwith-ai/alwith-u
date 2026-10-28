import { openUrl } from "@tauri-apps/plugin-opener"
import { beforeEach, expect, test, vi } from "vitest"

import { openPlatformAccount, openPlatformTopUp } from "../open-account"
import { authClient } from "../store"

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }))
vi.mock("../store", () => ({ authClient: { getSsoOtp: vi.fn() } }))

beforeEach(() => {
  vi.mocked(openUrl).mockReset().mockResolvedValue()
  vi.mocked(authClient.getSsoOtp).mockReset().mockResolvedValue({ otp: "one-time-code" })
})

test("top-up opens pricing through the account SSO route", async () => {
  await openPlatformTopUp()
  const url = new URL(vi.mocked(openUrl).mock.calls[0]![0])
  expect(url.origin).toBe("https://www-dev.alwith.ai")
  expect(url.pathname).toBe("/sso")
  expect(url.searchParams.get("otp")).toBe("one-time-code")
  expect(url.searchParams.get("redirect")).toBe("/pricing")
})

test("top-up opens pricing directly when SSO is unavailable", async () => {
  vi.mocked(authClient.getSsoOtp).mockRejectedValue(new Error("Signed out"))
  await openPlatformTopUp()
  expect(openUrl).toHaveBeenCalledWith("https://www-dev.alwith.ai/pricing")
})

test("existing account navigation retains its destination", async () => {
  await openPlatformAccount()
  const url = new URL(vi.mocked(openUrl).mock.calls[0]![0])
  expect(url.searchParams.get("redirect")).toBe("/account")
})

test("browser opening errors propagate to the caller", async () => {
  vi.mocked(openUrl).mockRejectedValue(new Error("Browser unavailable"))
  await expect(openPlatformTopUp()).rejects.toThrow("Browser unavailable")
})
