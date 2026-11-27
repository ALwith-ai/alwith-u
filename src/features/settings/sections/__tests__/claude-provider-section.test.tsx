import { act, fireEvent, render } from "@testing-library/react"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"
import { PROVIDERS, type ProviderSnapshot } from "@/lib/providers"

import { ClaudeProviderSection } from "../claude-provider-section"
import { ProviderRow } from "../provider-section"

const providers = vi.hoisted(() => ({ claudeLogin: vi.fn(), claudeLogout: vi.fn(), claudeUsage: vi.fn() }))
vi.mock("@/lib/providers", async (original) => ({
  ...(await original<typeof import("@/lib/providers")>()),
  ...providers
}))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

beforeAll(async () => {
  await initI18n("en")
})
beforeEach(() => {
  vi.clearAllMocks()
})

const anthropic = PROVIDERS.find((item) => item.id === "anthropic")
if (!anthropic) throw new Error("Anthropic provider fixture missing")
const signedIn = {
  configured: true,
  region: null,
  base_url: null,
  login: { email: "user@example.com", plan: "max_20x" }
}
const applied = (revision: number, anthropicKey?: typeof signedIn): ProviderSnapshot => ({
  revision,
  appliedRevision: revision,
  status: "applied",
  error: null,
  customProviders: [],
  providers: anthropicKey ? { anthropic: anthropicKey } : {}
})

test("signed out, the card offers the browser sign-in and waits for it", async () => {
  const pending = Promise.withResolvers<ProviderSnapshot>()
  providers.claudeLogin.mockReturnValue(pending.promise)
  const view = render(<ClaudeProviderSection snapshot={applied(4)} disabled={false} />)
  expect(view.container).toContainOneByText("Not signed in")
  expect(view.container).toContainOneByText("Use your Claude Pro or Max plan.")
  expect(view.queryByRole("button", { name: "Sign out" })).toBeNull()
  expect(providers.claudeUsage).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole("button", { name: "Sign in with Claude" }))
  expect(providers.claudeLogin).toHaveBeenCalledExactlyOnceWith(4)
  expect(view.container).toContainOneByText("Waiting for the browser…")
  // The spinner is part of the name while the browser is awaited.
  expect(view.getByRole("button", { name: /Sign in with Claude/ })).toBeDisabled()
  await act(async () => pending.resolve(applied(5)))
  expect(view.getByRole("button", { name: "Sign in with Claude" })).toBeEnabled()
})

test("signed in, the card names the account and plan, lists each limit and signs out", async () => {
  const week = Date.UTC(2026, 11, 2, 15) / 1000
  providers.claudeUsage.mockResolvedValue({
    windows: [
      { label: null, usedPercent: 12, windowDurationMins: 300, resetsAt: null },
      { label: null, usedPercent: 24, windowDurationMins: 10_080, resetsAt: week },
      { label: "Fable", usedPercent: 44, windowDurationMins: 10_080, resetsAt: week }
    ]
  })
  providers.claudeLogout.mockResolvedValue(applied(8))
  const view = render(<ClaudeProviderSection snapshot={applied(7, signedIn)} disabled={false} />)
  expect(view.container).toContainOneByText("user@example.com · Max 20x")
  await act(async () => {})
  expect(providers.claudeUsage).toHaveBeenCalledOnce()
  expect(view.getByRole("progressbar", { name: "5-hour" })).toHaveAttribute("aria-valuenow", "88")
  expect(view.getByRole("progressbar", { name: "7-day" })).toHaveAttribute("aria-valuenow", "76")
  expect(view.getByRole("progressbar", { name: "Fable" })).toHaveAttribute("aria-valuenow", "56")
  expect(view.queryByRole("button", { name: "Sign in with Claude" })).toBeNull()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Sign out" })))
  expect(providers.claudeLogout).toHaveBeenCalledExactlyOnceWith(7)
  expect(toast.error).not.toHaveBeenCalled()
})

test("usage that cannot be read is said so, and a failed sign-in reports why", async () => {
  providers.claudeUsage.mockRejectedValue(new Error("Claude did not report the subscription usage"))
  const view = render(<ClaudeProviderSection snapshot={applied(7, signedIn)} disabled={false} />)
  await act(async () => {})
  expect(view.container).toContainOneByText("No usage data")
  view.unmount()

  providers.claudeLogin.mockRejectedValue(new Error("Claude sign-in failed: access_denied"))
  const signedOut = render(<ClaudeProviderSection snapshot={applied(1)} disabled={false} />)
  await act(async () => fireEvent.click(signedOut.getByRole("button", { name: "Sign in with Claude" })))
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("access_denied"))
  expect(signedOut.getByRole("button", { name: "Sign in with Claude" })).toBeEnabled()
})

test("the Anthropic row keeps its API key, and a subscription login replaces the key settings", () => {
  const key = render(<ProviderRow provider={anthropic} saved={null} revision={4} busy={false} onSave={vi.fn()} />)
  expect(key.container).toContainOneByLabelText("API key")
  expect(key.queryByRole("button", { name: "Sign in with Claude" })).toBeNull()
  key.unmount()
  const login = render(<ProviderRow provider={anthropic} saved={signedIn} revision={7} busy={false} onSave={vi.fn()} />)
  expect(login.container).toContainOneByText(
    "Runs on the Claude subscription signed in above. Sign out to use an API key."
  )
  expect(login.queryByLabelText("API key")).toBeNull()
  expect(login.queryByRole("button", { name: "Save" })).toBeNull()
})
