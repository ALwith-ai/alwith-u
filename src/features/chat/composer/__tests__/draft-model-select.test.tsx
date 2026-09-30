import { afterEach, beforeAll, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../../codex/__tests__/dom-environment"
import { DraftModelSelect } from "../draft-model-select"

installDom()
beforeAll(async () => {
  await initI18n("en")
})
afterEach(cleanup)

test("draft shows the configured provider models before any session exists", async () => {
  let selected: string | null = null
  const view = render(
    <DraftModelSelect
      snapshot={{
        revision: 1,
        appliedRevision: 1,
        providers: { deepseek: { configured: true } },
        customProviders: [],
        status: "applied",
        error: null
      }}
      model={null}
      onChange={model => {
        selected = model
      }}
    />
  )
  const trigger = view.getByRole("button")
  await act(async () => {
    fireEvent.click(trigger)
  })
  expect(document.body.textContent).toContain("DeepSeek-Flash")
  expect(document.body.textContent).not.toContain("OpenRouter")
  expect(document.body.innerHTML).not.toContain("test-secret-never-render")
  await act(async () => {
    fireEvent.click(view.getByText("DeepSeek-Flash"))
  })
  expect(selected).toBe("gateway:deepseek:deepseek-flash")
})

test("removing a provider does not silently switch a selected draft to Codex", () => {
  const view = render(
    <DraftModelSelect
      snapshot={{
        revision: 2,
        appliedRevision: 2,
        providers: {},
        customProviders: [],
        status: "applied",
        error: null
      }}
      model="gateway:deepseek:deepseek-flash"
      onChange={() => {
        throw new Error("Unexpected model switch")
      }}
    />
  )
  expect(view.getByRole("button").textContent).toContain("deepseek-flash")
})
