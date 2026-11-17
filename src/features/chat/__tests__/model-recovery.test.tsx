import { createSession } from "@alwith/module-chat/client"
import { ModelRecovery } from "@alwith/module-chat/desktop"
import { act, fireEvent, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { providersPort } from "@/lib/providers"
import { openSettingsWindow } from "@/lib/window-manager"

import { ChatHostProvider } from "../chat-host"

vi.mock("@/lib/window-manager", () => ({ openSettingsWindow: vi.fn() }))
await initI18n("en")

test("model recovery retries the original session automatically and exposes model settings", async () => {
  const original = client.state
  const response = Promise.withResolvers<void>()
  const open = vi.spyOn(client, "open").mockImplementation(() => response.promise)
  client.store.setState({ connection: "ready" })
  const session = createSession("missing-model", "/tmp/original")
  const view = render(
    <ThemeProvider>
      <ChatHostProvider>
        <ModelRecovery client={client} session={session} providers={providersPort} />
      </ChatHostProvider>
    </ThemeProvider>
  )
  try {
    expect(view.queryByText("Open in another app")).not.toBeInTheDocument()
    expect(view.queryByTestId("model-trigger")).not.toBeInTheDocument()
    const retry = view.getByRole("button", { name: "Retry" })
    await act(() =>
      Promise.try(() => {
        fireEvent.click(retry)
        fireEvent.click(retry)
      })
    )
    expect(open).toHaveBeenCalledExactlyOnceWith("missing-model", "/tmp/original")
    expect(retry).toBeDisabled()
    await act(() => Promise.try(() => response.reject(new Error("No available models"))))
    expect(view.getByRole("alert")).toHaveTextContent("No available models")
    expect(retry).toBeEnabled()
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Models" }))))
    expect(openSettingsWindow).toHaveBeenCalledWith("provider")
  } finally {
    view.unmount()
    open.mockRestore()
    client.store.setState(original, true)
    vi.clearAllMocks()
  }
})
