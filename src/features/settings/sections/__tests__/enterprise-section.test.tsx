import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({
  user: { user_uuid: "alice" },
  onEvent: null as ((event: { payload: Record<string, unknown> }) => void) | null,
  status: vi.fn(),
  begin: vi.fn(),
  cancel: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  request: vi.fn(),
  open: vi.fn()
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, callback) => {
    host.onEvent = callback
    return () => {
      host.onEvent = null
    }
  })
}))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/bindings", () => ({
  commands: {
    enterpriseStatus: host.status,
    enterpriseBegin: host.begin,
    enterpriseCancel: host.cancel,
    enterpriseLogout: host.logout
  }
}))
vi.mock("@/lib/open", () => ({ openExternal: host.open }))
vi.mock("@/features/auth/store", () => ({
  usePlatformAuth: Object.assign(
    (select: (state: { user: typeof host.user }) => unknown) => select({ user: host.user }),
    { getState: () => ({ user: host.user }) }
  ),
  platformApiRequest: host.request,
  requestEnterpriseProviderRefresh: host.refresh
}))
import { EnterpriseSection } from "../enterprise-section"
beforeEach(() => {
  vi.clearAllMocks()
  host.user = { user_uuid: "alice" }
  host.status.mockResolvedValue({ generation: 7, automatic_renewal: false, requires_login: false, error: null })
  host.request.mockResolvedValue({ enabled: true, authorization_status: "none" })
  host.refresh.mockResolvedValue(undefined)
  host.begin.mockResolvedValue({ state: "proof", authorization_url: "https://login.example/authorize" })
  host.cancel.mockResolvedValue(null)
  host.open.mockResolvedValue(undefined)
})
test("enterprise sign-in opens the native authorization URL and cancellation carries its proof", async () => {
  render(<EnterpriseSection />)
  await screen.findByText("enterprise.signedOut")
  fireEvent.click(screen.getByRole("button", { name: "enterprise.login" }))
  await waitFor(() => expect(host.open).toHaveBeenCalledWith("https://login.example/authorize"))
  expect(host.begin).toHaveBeenCalledWith({ generation: 7 })
  fireEvent.click(screen.getByRole("button", { name: "enterprise.cancel" }))
  await waitFor(() => expect(host.cancel).toHaveBeenCalledWith({ generation: 7, state: "proof" }))
  expect(host.request).not.toHaveBeenCalledWith(expect.anything(), "DELETE")
})
test("account replacement while preparing login cannot open the old callback", async () => {
  let finish!: () => void
  host.refresh.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(<EnterpriseSection />)
  await screen.findByText("enterprise.signedOut")
  fireEvent.click(screen.getByRole("button", { name: "enterprise.login" }))
  host.user = { user_uuid: "alice" }
  await act(async () => finish())
  expect(host.begin).not.toHaveBeenCalled()
  expect(host.open).not.toHaveBeenCalled()
})
test("status errors expose retry without claiming enterprise authorization", async () => {
  host.request.mockRejectedValue(new Error("offline"))
  render(<EnterpriseSection />)
  await screen.findByRole("alert")
  expect(screen.getByRole("button", { name: "actions.retry" })).toBeInTheDocument()
  expect(screen.queryByText("enterprise.accountHint")).not.toBeInTheDocument()
})

test("a failed native callback releases the pending login so it can be retried", async () => {
  render(<EnterpriseSection />)
  await screen.findByText("enterprise.signedOut")
  fireEvent.click(screen.getByRole("button", { name: "enterprise.login" }))
  await screen.findByRole("button", { name: "enterprise.cancel" })
  await act(async () => {
    host.onEvent?.({
      payload: { type: "enterpriseLoginCompleted", accountId: "alice", generation: 7, error: "expired" }
    })
  })
  expect(screen.queryByRole("button", { name: "enterprise.cancel" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "enterprise.login" })).toBeInTheDocument()
})

test("switching accounts during a pending sign-in unlocks the new account controls", async () => {
  let release!: () => void
  host.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const view = render(<EnterpriseSection />)
  await screen.findByText("enterprise.signedOut")
  fireEvent.click(screen.getByRole("button", { name: "enterprise.login" }))
  expect(screen.getByRole("button", { name: "enterprise.login" })).toBeDisabled()
  host.user = { user_uuid: "bob" }
  view.rerender(<EnterpriseSection />)
  await waitFor(() => expect(screen.getByRole("button", { name: "enterprise.login" })).toBeEnabled())
  await act(async () => release())
  expect(host.begin).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "enterprise.login" })).toBeEnabled()
})
