import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { ModelSelectGroup } from "../model-select-group"

const controls = vi.hoisted(() => ({ setConfig: vi.fn(), error: vi.fn(), pending: false }))
vi.mock("@/lib/client", () => ({
  client: { setConfig: controls.setConfig },
  useApp: () => controls.pending
}))
vi.mock("sonner", () => ({ toast: { error: controls.error } }))

const nativeModel = "gpt-6-astra"
const providerModel = "gateway:deepseek:deepseek-flash"
function options(currentValue: string): acp.SessionConfigOption[] {
  return [
    {
      configId: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue,
      options: [
        { groupId: "chatgpt", name: "ChatGPT", options: [{ value: nativeModel, name: "GPT-6-Astra" }] },
        { groupId: "deepseek", name: "DeepSeek", options: [{ value: providerModel, name: "DeepSeek-Flash" }] }
      ]
    }
  ]
}

beforeAll(() => initI18n("en"))
afterEach(() => {
  cleanup()
  controls.setConfig.mockReset()
  controls.error.mockReset()
  controls.pending = false
})

test("the shared window model menu selects the DeepSeek gateway and returns to the native Codex model", async () => {
  controls.setConfig.mockResolvedValue(undefined)
  const view = render(<ModelSelectGroup sessionId="floating-session" options={options(nativeModel)} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button"))))
  expect(view.getByText("DeepSeek")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByText("DeepSeek-Flash"))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("floating-session", "model", providerModel)
  // Only the confirmed session configuration changes the selected label.
  expect(view.getByRole("button").textContent).toContain("GPT-6-Astra")
  view.rerender(<ModelSelectGroup sessionId="floating-session" options={options(providerModel)} disabled={false} />)
  expect(view.getByRole("button").textContent).toContain("DeepSeek-Flash")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByText("GPT-6-Astra"))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("floating-session", "model", nativeModel)
  expect(controls.setConfig).toHaveBeenCalledTimes(2)
})

test("the model picker is disabled during a provider change", () => {
  controls.pending = true
  const view = render(<ModelSelectGroup sessionId="main-session" options={options(nativeModel)} disabled={false} />)
  expect(view.getByRole("button")).toBeDisabled()
  fireEvent.click(view.getByRole("button"))
  expect(controls.setConfig).not.toHaveBeenCalled()
})

test("a rejected provider switch reports the failure and keeps the confirmed model label", async () => {
  controls.setConfig.mockRejectedValue(new Error("DeepSeek unavailable"))
  const view = render(<ModelSelectGroup sessionId="main-session" options={options(nativeModel)} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByText("DeepSeek-Flash"))))
  await waitFor(() => expect(controls.error).toHaveBeenCalledWith("DeepSeek unavailable"))
  expect(view.getByRole("button").textContent).toContain("GPT-6-Astra")
})

test("unsent draft provider changes go through replacement instead of changing the existing session", async () => {
  const onModelChange = vi.fn()
  const view = render(
    <ModelSelectGroup sessionId="draft" options={options(nativeModel)} disabled={false} onModelChange={onModelChange} />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByText("DeepSeek-Flash"))))
  expect(onModelChange).toHaveBeenCalledWith(providerModel)
  expect(controls.setConfig).not.toHaveBeenCalled()
})

test("the model menu omits collaboration mode while retaining other model settings", async () => {
  controls.setConfig.mockResolvedValue(undefined)
  const config: acp.SessionConfigOption[] = [
    ...options(nativeModel),
    {
      configId: "collaboration_mode",
      category: "model_config",
      name: "Collaboration mode",
      type: "select",
      currentValue: "plan",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" }
      ]
    },
    {
      configId: "response_style",
      category: "model_config",
      name: "Response style",
      type: "select",
      currentValue: "concise",
      options: [
        { value: "concise", name: "Concise" },
        { value: "detailed", name: "Detailed" }
      ]
    }
  ]
  const view = render(<ModelSelectGroup sessionId="main-session" options={config} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button"))))
  expect(view.queryByText("Collaboration mode")).not.toBeInTheDocument()
  expect(view.queryByText("Default")).not.toBeInTheDocument()
  expect(view.queryByText("Plan")).not.toBeInTheDocument()
  expect(view.getByText("Response style")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByText("Detailed"))))
  expect(controls.setConfig).toHaveBeenCalledWith("main-session", "response_style", "detailed")
})
