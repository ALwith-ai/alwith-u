import { render } from "@testing-library/react"
import { expect, test } from "vitest"

import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"

import { useChatActivityHost } from "../activity-host"

test("commands require a real exit code before reporting success", async () => {
  await initI18n("en")
  function CommandStatus() {
    const host = useChatActivityHost()
    const command = {
      type: "tool_use" as const,
      id: "cmd",
      name: "shell",
      title: "sleep",
      kind: "execute",
      status: "completed" as const,
      content: [],
      rawInput: { command: "sleep 45" }
    }
    return (
      <>
        <span data-testid="unknown">{host.commandStatus?.(command)}</span>
        <span data-testid="success">{host.commandStatus?.({ ...command, exitCode: 0 })}</span>
        <span data-testid="failed">{host.commandStatus?.({ ...command, exitCode: 2 })}</span>
      </>
    )
  }
  const view = render(<CommandStatus />)
  expect(view.getByTestId("unknown")).toBeEmptyDOMElement()
  expect(view.getByTestId("success")).toHaveTextContent("Success")
  expect(view.getByTestId("failed")).toHaveTextContent("2")
  view.unmount()
})

function HostLanguage() {
  const host = useChatActivityHost()
  return <span>{host.i18n.language}</span>
}

test.each(LANGUAGES)("chat activity formatting uses the selected $code locale", async ({ code }) => {
  await initI18n(code)
  const view = render(<HostLanguage />)

  expect(view.getByText(code)).toBeTruthy()
  view.unmount()
})

test("chat activity formatting uses English for an unsupported locale", async () => {
  await initI18n("en")
  await i18n.changeLanguage("xx")
  const view = render(<HostLanguage />)

  expect(view.getByText("en")).toBeTruthy()
})
