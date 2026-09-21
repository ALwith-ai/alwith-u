import { act, render } from "@testing-library/react"
import { expect, spyOn, test } from "bun:test"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import i18n, { initI18n } from "@/lib/i18n"
import { ErrorBoundary } from "../error-boundary"

installDom()

function Broken(): never {
  throw new Error("test crash")
}

test("the mounted production error fallback follows language changes", async () => {
  await initI18n("en")
  const runtime = window as unknown as Record<string, unknown>
  const originalTauriInternals = runtime.__TAURI_INTERNALS__
  runtime.__TAURI_INTERNALS__ = { invoke: async () => undefined }
  const consoleError = spyOn(console, "error").mockImplementation(() => undefined)
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
    consoleError.mockRestore()
    if (originalTauriInternals === undefined) delete runtime.__TAURI_INTERNALS__
    else runtime.__TAURI_INTERNALS__ = originalTauriInternals
  }
})
