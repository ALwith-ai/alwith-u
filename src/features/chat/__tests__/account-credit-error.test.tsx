import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AccountCreditError, isAccountCreditError } from "../account-credit-error"

const { open, error } = vi.hoisted(() => ({ open: vi.fn(), error: vi.fn() }))
vi.mock("@/features/auth/open-account", () => ({ openPlatformTopUp: open }))
vi.mock("sonner", () => ({ toast: { error } }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe("account credit errors", () => {
  it("recognizes only ALwith LiteLLM credit failures", () => {
    const message = "unexpected status 402 Payment Required: insufficient credits"
    expect(isAccountCreditError("gateway:litellm:flash", message)).toBe(true)
    expect(isAccountCreditError("gateway:alwith-managed-litellm:flash", message)).toBe(true)
    for (const model of [null, "gpt-6", "gateway:openrouter:flash", "gateway:litellm-other:flash"]) {
      expect(isAccountCreditError(model, message)).toBe(false)
    }
    expect(isAccountCreditError("gateway:litellm:flash", "402 Payment Required")).toBe(false)
    expect(isAccountCreditError("gateway:litellm:flash", "connection failed")).toBe(false)
  })
  it("opens recharge and reports navigation failures", async () => {
    open.mockRejectedValueOnce(new Error("Could not open browser"))
    render(<AccountCreditError />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(error).toHaveBeenCalledWith("Could not open browser"))
    expect(screen.getByRole("button")).toBeEnabled()
    open.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
  })
})
