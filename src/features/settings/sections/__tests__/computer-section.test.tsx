import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { must } from "@/lib/__tests__/must"
const native = vi.hoisted(() => ({
  permission: vi.fn(),
  enable: vi.fn(),
  stop: vi.fn(),
  enabled: false,
  permitted: false
}))
vi.mock("@/bindings", () => ({ commands: { computerRequestPermissions: native.permission } }))
vi.mock("@/lib/platform", () => ({ isMac: () => true }))
vi.mock("@/features/computer/computer-control", () => ({
  useComputerStatus: () => ({
    status: {
      available: true,
      enabled: native.enabled,
      permissions: { supported: true, accessibility: native.permitted, screenCapture: native.permitted }
    },
    error: null
  })
}))
vi.mock("@/features/computer/operations", () => ({ enableComputer: native.enable, stopComputer: native.stop }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { ComputerSection } from "../computer-section"
beforeEach(() => {
  native.enabled = false
  native.permitted = false
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
test("permission settings stay reachable across requests and reopening the page", async () => {
  native.permission.mockImplementation(({ request }) => (request ? new Promise(() => {}) : Promise.resolve()))
  const first = render(<ComputerSection />)
  expect(screen.queryByRole("combobox")).toBeNull()
  fireEvent.click(must(screen.getAllByRole("button", { name: "computer.grantPermissions" })[0], "permission request"))
  fireEvent.click(must(screen.getAllByRole("button", { name: "computer.openSettings" })[0], "accessibility settings"))
  expect(native.permission).toHaveBeenLastCalledWith({ permission: "accessibility", request: false })
  first.unmount()
  render(<ComputerSection />)
  fireEvent.click(must(screen.getAllByRole("button", { name: "computer.openSettings" })[1], "screen settings"))
  await waitFor(() =>
    expect(native.permission).toHaveBeenLastCalledWith({ permission: "screenCapture", request: false })
  )
})

test("switch requires system permissions to enable and can stop globally after permissions are revoked", async () => {
  const view = render(<ComputerSection />)
  expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true")
  native.permitted = true
  view.rerender(<ComputerSection />)
  fireEvent.click(screen.getByRole("switch"))
  await waitFor(() => expect(native.enable).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole("switch")).not.toHaveAttribute("aria-disabled", "true"))
  native.enabled = true
  native.permitted = false
  view.rerender(<ComputerSection />)
  expect(screen.getByRole("switch")).toBeChecked()
  fireEvent.click(screen.getByRole("switch"))
  await waitFor(() => expect(native.stop).toHaveBeenCalledOnce())
})
