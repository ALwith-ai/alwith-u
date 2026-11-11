import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { must } from "@/lib/__tests__/must"
const native = vi.hoisted(() => ({
  permission: vi.fn(),
  enable: vi.fn(),
  stop: vi.fn(),
  reconnect: vi.fn(),
  phase: "disabled",
  lastError: null as string | null,
  failedConnections: 0,
  enabled: false,
  permitted: false
}))
vi.mock("@alwith/module-computer/commands", () => ({
  commands: { requestPermissions: native.permission }
}))
vi.mock("@/lib/platform", () => ({ isMac: () => true }))
vi.mock("@/features/computer/computer-control", () => ({
  useComputerStatus: () => ({
    status: {
      available: true,
      phase: native.phase,
      driverPhase: native.phase,
      connections: { ready: 1, connecting: 0, disconnected: 0, failed: native.failedConnections },
      lastError: native.lastError,
      enabled: native.enabled,
      permissions: {
        supported: true,
        accessibility: native.permitted,
        screenCapture: native.permitted
      }
    },
    error: null
  })
}))
vi.mock("@/features/computer/operations", () => ({
  enableComputer: native.enable,
  stopComputer: native.stop,
  reconnectComputer: native.reconnect
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
import { ComputerSection } from "../computer-section"
beforeEach(() => {
  native.failedConnections = 0
  native.phase = "disabled"
  native.lastError = null
  native.enabled = false
  native.permitted = false
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
test("each permission shows only its current action", async () => {
  native.permission.mockResolvedValue(undefined)
  const view = render(<ComputerSection />)
  expect(screen.getAllByRole("button", { name: "computer.grantPermissions" })).toHaveLength(2)
  expect(screen.queryByRole("button", { name: "computer.openSettings" })).toBeNull()
  fireEvent.click(must(screen.getAllByRole("button", { name: "computer.grantPermissions" })[0], "permission request"))
  await waitFor(() =>
    expect(native.permission).toHaveBeenLastCalledWith({
      permission: "accessibility",
      request: true
    })
  )
  native.permitted = true
  view.rerender(<ComputerSection />)
  expect(screen.queryByRole("button", { name: "computer.grantPermissions" })).toBeNull()
  expect(screen.getAllByRole("button", { name: "computer.openSettings" })).toHaveLength(2)
  fireEvent.click(must(screen.getAllByRole("button", { name: "computer.openSettings" })[1], "screen settings"))
  await waitFor(() =>
    expect(native.permission).toHaveBeenLastCalledWith({
      permission: "screenCapture",
      request: false
    })
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

test("failed capability verification remains visible and reconnect waits for completion", async () => {
  native.permitted = true
  native.phase = "failed"
  native.lastError = "capture unavailable"
  let resolve!: () => void
  native.reconnect.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done
      })
  )
  render(<ComputerSection />)
  expect(screen.getByRole("alert")).toHaveTextContent("capture unavailable")
  fireEvent.click(screen.getByRole("button", { name: "computer.reconnect" }))
  expect(native.reconnect).toHaveBeenCalledOnce()
  expect(screen.getByRole("button", { name: "computer.verifying" })).toBeDisabled()
  resolve()
  await waitFor(() => expect(screen.getByRole("button", { name: "computer.reconnect" })).not.toBeDisabled())
})

test("ready driver does not hide a failed conversation connection", () => {
  native.enabled = true
  native.phase = "ready"
  native.failedConnections = 1
  render(<ComputerSection />)
  expect(screen.getByRole("switch")).toBeChecked()
  expect(screen.getByText("computer.connectionRecovery")).toBeInTheDocument()
})
