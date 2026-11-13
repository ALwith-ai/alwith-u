import { createSession } from "@alwith/module-chat/client"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import type { ProviderSnapshot } from "@/lib/providers"

import { ModelRecovery } from "../model-recovery"

const control = vi.hoisted(() => ({ error: vi.fn(), snapshot: null as ProviderSnapshot | null }))
vi.mock("@/lib/use-providers", () => ({ useProviders: () => control.snapshot }))
vi.mock("sonner", () => ({ toast: { error: control.error } }))

await initI18n("en")
const original = client.state
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  client.store.setState(original, true)
  control.error.mockReset()
  control.snapshot = null
})

test("recovery requires a concrete native selection and preserves it after failure for retry", async () => {
  client.store.setState({ nativeModels: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol" }] })
  const response = Promise.withResolvers<void>()
  const resume = vi
    .spyOn(client, "resumeModel")
    .mockImplementationOnce(() => response.promise)
    .mockResolvedValue()
  const create = vi.spyOn(client, "newSession")
  const prompt = vi.spyOn(client, "prompt")
  const view = render(<ModelRecovery session={createSession("original", "/tmp/original")} />)
  const continueButton = view.getByRole("button", { name: "Continue with selected model" })
  expect(view.getByText("Select a model to continue. History remains available.")).toBeVisible()
  expect(continueButton).toBeDisabled()
  await act(async () => fireEvent.click(view.getByTestId("model-trigger")))
  await act(async () => fireEvent.click(view.getByText("GPT-6.1 Sol")))
  expect(continueButton).toBeEnabled()
  await act(async () => fireEvent.click(continueButton))
  expect(resume).toHaveBeenCalledExactlyOnceWith("original", "gpt-6.1-sol")
  expect(continueButton).toBeDisabled()
  await act(async () => response.reject(new Error("Provider configuration failed")))
  expect(control.error).toHaveBeenCalledWith("Provider configuration failed")
  expect(continueButton).toBeEnabled()
  await act(async () => fireEvent.click(continueButton))
  expect(resume).toHaveBeenCalledTimes(2)
  expect(resume).toHaveBeenLastCalledWith("original", "gpt-6.1-sol")
  expect(create).not.toHaveBeenCalled()
  expect(prompt).not.toHaveBeenCalled()
})

test("removing a selected gateway disables recovery without silently selecting another model", async () => {
  control.snapshot = {
    revision: 1,
    appliedRevision: 1,
    status: "applied",
    error: null,
    providers: { deepseek: { configured: true, region: null, base_url: null } },
    customProviders: []
  }
  client.store.setState({ nativeModels: [] })
  const resume = vi.spyOn(client, "resumeModel").mockResolvedValue()
  const session = createSession("gateway-history", "/tmp/original")
  const view = render(<ModelRecovery session={session} />)
  await act(async () => fireEvent.click(view.getByTestId("model-trigger")))
  await act(async () => fireEvent.click(view.getByText("Flash")))
  const continueButton = view.getByRole("button", { name: "Continue with selected model" })
  expect(continueButton).toBeEnabled()
  control.snapshot = { ...control.snapshot, revision: 2, appliedRevision: 2, providers: {} }
  view.rerender(<ModelRecovery session={session} />)
  expect(continueButton).toBeDisabled()
  expect(view.getByTestId("model-trigger")).toHaveTextContent("deepseek-flash")
  expect(resume).not.toHaveBeenCalled()
})
