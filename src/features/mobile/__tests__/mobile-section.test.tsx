import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

const host = vi.hoisted(() => ({
  status: vi.fn(),
  devices: vi.fn(),
  pair: vi.fn(),
  revoke: vi.fn(),
  enable: vi.fn()
}))
vi.mock("@/bindings", () => ({
  commands: {
    mobileBridgeStatus: host.status,
    bridgeTrustedList: host.devices,
    bridgePairingStart: host.pair,
    bridgeTrustedRevoke: host.revoke
  }
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }))
vi.mock("@/lib/settings-store", () => ({ settingsStore: { subscribe: () => () => {} } }))
vi.mock("../bridge", () => ({
  mobileEnabled: () => true,
  setMobileEnabled: host.enable,
  MOBILE_RELAY_URL: "wss://relay.test"
}))
vi.mock("../phone-login-view", () => ({ PhoneLoginView: () => <div>Sign-in flow</div> }))
import { MobileSection } from "../mobile-section"

beforeAll(() => initI18n("en"))
beforeEach(() => {
  vi.useFakeTimers()
  host.status.mockResolvedValue({ running: true, connected: true, relayConnected: true })
  host.devices.mockResolvedValue([])
  host.revoke.mockResolvedValue(undefined)
  host.pair.mockResolvedValue({
    deviceId: "u",
    publicKeyB64: "key",
    code: "123456",
    hostApp: "u",
    expiresAt: Date.now() + 1000
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

test("keeps expired pairing visible with a refresh action and keeps sign-in in account settings", async () => {
  render(<MobileSection />)
  await flush()
  expect(screen.getByText(/No phones paired yet/)).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Show pairing QR code" }))
  await flush()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100)
  })
  expect(screen.getByText(/This pairing QR code has expired/)).toBeVisible()
  expect(screen.getByRole("button", { name: "Refresh pairing QR code" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Sign in on phone" })).not.toBeInTheDocument()
})

test("successful polling does not erase an action failure", async () => {
  host.pair.mockRejectedValue(new Error("Pairing unavailable"))
  render(<MobileSection />)
  await flush()
  fireEvent.click(screen.getByRole("button", { name: "Show pairing QR code" }))
  await flush()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100)
  })
  expect(screen.getByRole("alert")).toHaveTextContent("Pairing unavailable")
})

test("identifies trusted devices and revokes only after confirmation", async () => {
  host.devices.mockResolvedValue([
    { deviceId: "phone-12345678", name: "My phone", model: "iPhone", pairedAt: 1700000000000 }
  ])
  render(<MobileSection />)
  await flush()
  expect(screen.getByText("iPhone · 12345678")).toBeVisible()
  expect(screen.getByRole("list", { name: "Paired phones" })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Unpair" }))
  expect(host.revoke).not.toHaveBeenCalled()
  const dialog = screen.getByRole("alertdialog")
  expect(within(dialog).getByText(/ALwith account will stay signed in/)).toBeVisible()
  fireEvent.click(within(dialog).getByRole("button", { name: "Unpair" }))
  await flush()
  expect(host.revoke).toHaveBeenCalledWith({ deviceId: "phone-12345678" })
  expect(screen.queryByText("My phone")).not.toBeInTheDocument()
})
