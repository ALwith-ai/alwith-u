import { act, render } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import i18n, { initI18n } from "@/lib/i18n"
import { ErrorBoundary } from "../error-boundary"

function Broken(): never {
  throw new Error("test crash")
}

test("the mounted production error fallback follows language changes", async () => {
  await initI18n("en")
  const runtime = window as unknown as Record<string, unknown>
  const originalTauriInternals = runtime.__TAURI_INTERNALS__
  runtime.__TAURI_INTERNALS__ = { invoke: async () => undefined }
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
  // Vitest runs in development mode; the production fallback is the one under test.
  vi.stubEnv("DEV", false)
  try {
    const view = render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    )

    expect(view.getByText("Something went wrong.")).toBeTruthy()
    await act(async () => {
      await i18n.changeLanguage("zh-CN")
    })
    expect(view.getByText("出了点问题。")).toBeTruthy()
    expect(view.getByRole("button", { name: "重试" })).toBeTruthy()
    await Promise.resolve()
  } finally {
    vi.unstubAllEnvs()
    consoleError.mockRestore()
    if (originalTauriInternals === undefined) delete runtime.__TAURI_INTERNALS__
    else runtime.__TAURI_INTERNALS__ = originalTauriInternals
  }
})
