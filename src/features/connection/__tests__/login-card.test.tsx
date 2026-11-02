import type { AuthMethod } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

const notify = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock("sonner", () => ({ toast: notify }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { LoginCard } from "../login-card"

const methods: AuthMethod[] = [
  { type: "agent", methodId: "api-key", name: "API key" },
  { type: "agent", methodId: "chat-gpt", name: "ChatGPT" },
  { type: "agent", methodId: "chat-gpt-device-code", name: "Device code" }
]
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test.each(["connection.signIn", "connection.signInDevice"])(
  "%s keeps its label and prevents duplicate login while pending",
  async (label) => {
    let finish!: () => void
    const signIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<LoginCard methods={methods} signIn={signIn} />)
    const button = screen.getByRole("button", { name: label })
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button).toHaveTextContent(label)
    expect(screen.getAllByRole("status", { name: "Loading" })).toHaveLength(1)
    for (const action of screen.getAllByRole("button")) expect(action).toBeDisabled()
    fireEvent.click(button)
    expect(signIn).toHaveBeenCalledOnce()
    await act(async () => finish())
    expect(button).toHaveAttribute("aria-busy", "false")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    for (const action of screen.getAllByRole("button")) expect(action).toBeEnabled()
  }
)

test("failed login clears the pending state so it can be retried", async () => {
  const signIn = vi.fn().mockRejectedValue(new Error("Login cancelled"))
  render(<LoginCard methods={methods} signIn={signIn} />)
  const button = screen.getByRole("button", { name: "connection.signIn" })
  await act(async () => fireEvent.click(button))
  expect(notify.error).toHaveBeenCalledWith("Login cancelled")
  expect(button).toBeEnabled()
  expect(button).toHaveAttribute("aria-busy", "false")
})
