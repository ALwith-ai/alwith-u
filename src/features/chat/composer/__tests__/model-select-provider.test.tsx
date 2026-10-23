import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { modelTriggerLabel, presentModelCatalog } from "../model-catalog"
import { ModelSelectGroup } from "../model-select-group"

const controls = vi.hoisted(() => ({
  setConfig: vi.fn(),
  error: vi.fn(),
  openSettings: vi.fn(),
  pending: false
}))
vi.mock("@/lib/client", () => ({
  client: { setConfig: controls.setConfig },
  useApp: () => controls.pending
}))
vi.mock("@/lib/window-manager", () => ({ openSettingsWindow: controls.openSettings }))
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
        {
          groupId: "chatgpt",
          name: "ChatGPT",
          options: [{ value: nativeModel, name: "GPT-6-Astra" }]
        },
        {
          groupId: "deepseek",
          name: "DeepSeek",
          options: [{ value: providerModel, name: "DeepSeek-Flash" }]
        }
      ]
    }
  ]
}

beforeAll(() => initI18n("en"))
afterEach(() => {
  cleanup()
  controls.openSettings.mockReset()
  controls.setConfig.mockReset()
  controls.error.mockReset()
  controls.pending = false
})

test("catalog-supplied short labels override local presentation without changing model identity or full names", () => {
  const model = { api_id: "gpt-6-sol", label: "Catalog model name", shortLabel: "Catalog short name" }
  const [group] = presentModelCatalog([{ id: "chatgpt", name: "ChatGPT", models: [model] }], model.api_id)
  expect(group.models[0]).toMatchObject(model)
  expect(modelTriggerLabel(group.models[0])).toBe("Catalog short name")
})

test("models without a short label keep the catalog name in the trigger and menu", async () => {
  const view = render(
    <ModelSelectGroup
      sessionId="full-label"
      disabled={false}
      options={[
        {
          configId: "model",
          category: "model",
          name: "Model",
          type: "select",
          currentValue: "future-model",
          options: [{ value: "future-model", name: "GPT Future Model" }]
        }
      ]}
    />
  )
  expect(view.getByTestId("model-trigger")).toHaveTextContent(/^GPT Future Model$/)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.getByRole("menuitemradio", { name: "GPT Future Model" })).toHaveAttribute("aria-checked", "true")
})

test("the composer uses the configured short label while the menu preserves the full name", async () => {
  const view = render(
    <ModelSelectGroup
      sessionId="short-label"
      disabled={false}
      options={[
        {
          configId: "model",
          category: "model",
          name: "Model",
          type: "select",
          currentValue: "gpt-6-sol",
          options: [{ value: "gpt-6-sol", name: "GPT-6-Sol" }]
        }
      ]}
    />
  )
  expect(view.getByTestId("model-trigger")).toHaveTextContent(/^6-Sol$/)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.getByRole("menuitemradio", { name: "GPT-6-Sol" })).toHaveAttribute("aria-checked", "true")
  expect(controls.setConfig).not.toHaveBeenCalled()
})

test("the shared window model menu selects the DeepSeek gateway and returns to the native Codex model", async () => {
  controls.setConfig.mockResolvedValue(undefined)
  const view = render(<ModelSelectGroup sessionId="floating-session" options={options(nativeModel)} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(document.querySelector("[data-slot=dropdown-menu-label]")).not.toBeInTheDocument()
  await act(() => Promise.try(() => fireEvent.click(view.getByText("DeepSeek-Flash"))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("floating-session", "model", providerModel)
  // Only the confirmed session configuration changes the selected label.
  expect(view.getByTestId("model-trigger")).toHaveTextContent(/^6-Astra$/)
  view.rerender(<ModelSelectGroup sessionId="floating-session" options={options(providerModel)} disabled={false} />)
  expect(within(view.getByTestId("model-trigger")).getByText("Flash", { exact: true })).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByText("GPT-6-Astra"))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("floating-session", "model", nativeModel)
  expect(controls.setConfig).toHaveBeenCalledTimes(2)
})

test("the model picker is disabled during a provider change", () => {
  controls.pending = true
  const view = render(<ModelSelectGroup sessionId="main-session" options={options(nativeModel)} disabled={false} />)
  expect(view.getByTestId("model-trigger")).toBeDisabled()
  fireEvent.click(view.getByTestId("model-trigger"))
  expect(controls.setConfig).not.toHaveBeenCalled()
})

test("a rejected provider switch reports the failure and keeps the confirmed model label", async () => {
  controls.setConfig.mockRejectedValue(new Error("DeepSeek unavailable"))
  const view = render(<ModelSelectGroup sessionId="main-session" options={options(nativeModel)} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByText("DeepSeek-Flash"))))
  await waitFor(() => expect(controls.error).toHaveBeenCalledWith("DeepSeek unavailable"))
  expect(view.getByTestId("model-trigger")).toHaveTextContent(/^6-Astra$/)
})

test("unsent draft provider changes go through replacement instead of changing the existing session", async () => {
  const onModelChange = vi.fn()
  const view = render(
    <ModelSelectGroup sessionId="draft" options={options(nativeModel)} disabled={false} onModelChange={onModelChange} />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
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
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.queryByText("Collaboration mode")).not.toBeInTheDocument()
  expect(view.queryByText("Default")).not.toBeInTheDocument()
  expect(view.queryByText("Plan")).not.toBeInTheDocument()
  expect(view.getByText("Response style")).toBeVisible()
  await act(() => Promise.try(() => fireEvent.click(view.getByText("Detailed"))))
  expect(controls.setConfig).toHaveBeenCalledWith("main-session", "response_style", "detailed")
})

function catalogOptions(currentValue: string, gateways = true): acp.SessionConfigOption[] {
  return [
    {
      configId: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue,
      options: [
        {
          groupId: "chatgpt",
          name: "ChatGPT",
          options: ["First", "Second", "Third", "Fourth", "Fifth"].map((name) => ({ value: name, name }))
        },
        ...(gateways
          ? [
              {
                groupId: "qwen",
                name: "Qwen",
                options: [
                  { value: "q1", name: "3.8 Max" },
                  { value: "q2", name: "3.8 Flash" }
                ]
              }
            ]
          : [])
      ]
    }
  ]
}

test("configured catalogs expose every native and gateway model in the scrollable list", async () => {
  controls.setConfig.mockResolvedValue(undefined)
  const view = render(<ModelSelectGroup sessionId="catalog" options={catalogOptions("First")} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(
    view
      .getAllByRole("menuitemradio")
      .map((item) => item.querySelector("span.flex-1")?.textContent ?? item.querySelector("span.truncate")?.textContent)
  ).toEqual(["First", "Second", "Third", "3.8 Max", "Fourth", "Fifth", "3.8 Flash"])
  expect(view.getAllByText("More models")).toHaveLength(1)
  expect(view.getAllByRole("menuitemradio").every((item) => item.querySelector("svg, img"))).toBe(true)
  await act(() => Promise.try(() => fireEvent.click(view.getByText("3.8 Flash"))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("catalog", "model", "q2")
})

test("native catalogs keep every model visible in catalog order", async () => {
  const view = render(
    <ModelSelectGroup sessionId="catalog" options={catalogOptions("Fifth", false)} disabled={false} />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(
    view
      .getAllByRole("menuitemradio")
      .map((item) => item.querySelector("span.flex-1")?.textContent ?? item.querySelector("span.truncate")?.textContent)
  ).toEqual(["First", "Second", "Third", "Fourth", "Fifth"])
})

test("an applied DeepSeek catalog appears before native overflow in an already open draft", async () => {
  const native = Array.from({ length: 20 }, (_, index) => ({ value: `gpt-${index}`, name: `GPT-${index}` }))
  const config = (configured: boolean): acp.SessionConfigOption[] => [
    {
      configId: "model",
      category: "model",
      name: "Model",
      type: "select",
      currentValue: "gpt-0",
      options: [
        { groupId: "chatgpt", name: "ChatGPT", options: native },
        ...(configured
          ? [{ groupId: "deepseek", name: "DeepSeek", options: [{ value: providerModel, name: "DeepSeek-Flash" }] }]
          : [])
      ]
    }
  ]
  const onModelChange = vi.fn()
  const view = render(
    <ModelSelectGroup sessionId="draft" options={config(false)} disabled={false} onModelChange={onModelChange} />
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.queryByRole("menuitemradio", { name: "DeepSeek-Flash" })).not.toBeInTheDocument()
  view.rerender(
    <ModelSelectGroup sessionId="draft" options={config(true)} disabled={false} onModelChange={onModelChange} />
  )
  const choices = view.getAllByRole("menuitemradio")
  expect(choices).toHaveLength(21)
  expect(choices[3]).toHaveAccessibleName("DeepSeek-Flash")
  await act(() => Promise.try(() => fireEvent.click(choices[3])))
  expect(onModelChange).toHaveBeenCalledWith(providerModel)
  expect(controls.setConfig).not.toHaveBeenCalled()
})

test("unsupported fast mode stays visible and disabled", async () => {
  const view = render(<ModelSelectGroup sessionId="catalog" options={catalogOptions("q2")} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.getByRole("menuitemcheckbox", { name: "Fast mode" })).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(view.getByRole("menuitemcheckbox", { name: "Fast mode" }))
  expect(controls.setConfig).not.toHaveBeenCalled()
  expect(view.getByRole("menuitemcheckbox", { name: "Fast mode" })).not.toBeChecked()
  expect(view.getByRole("menuitemradio", { name: "3.8 Flash" })).toBeVisible()
})

test("supported fast mode and explicit effort levels target the owning session", async () => {
  controls.setConfig.mockResolvedValue(undefined)
  const config: acp.SessionConfigOption[] = [
    ...catalogOptions("First"),
    {
      configId: "fast-mode",
      category: "model_config",
      name: "Fast mode",
      type: "boolean",
      currentValue: true
    },
    {
      configId: "effort",
      category: "thought_level",
      name: "Reasoning effort",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" }
      ]
    }
  ]
  const view = render(<ModelSelectGroup sessionId="owner" options={config} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  expect(view.getByRole("menuitemcheckbox", { name: "Fast mode" })).toBeChecked()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitemcheckbox", { name: "Fast mode" }))))
  expect(controls.setConfig).toHaveBeenLastCalledWith("owner", "fast-mode", false)
  const slider = view.getByRole("slider", { name: "Effort" })
  expect(slider).toHaveAttribute("aria-valuetext", "Medium")
  await act(() => Promise.try(() => fireEvent.keyDown(slider, { key: "ArrowRight" })))
  expect(controls.setConfig).toHaveBeenLastCalledWith("owner", "effort", "high")
})

test("the more models footer opens provider configuration and reports opening failures", async () => {
  controls.openSettings.mockRejectedValue(new Error("Settings unavailable"))
  const view = render(<ModelSelectGroup sessionId="owner" options={options(nativeModel)} disabled={false} />)
  await act(() => Promise.try(() => fireEvent.click(view.getByTestId("model-trigger"))))
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "More models" }))))
  expect(controls.openSettings).toHaveBeenCalledWith("provider")
  await waitFor(() => expect(controls.error).toHaveBeenCalledWith("Settings unavailable"))
  expect(controls.setConfig).not.toHaveBeenCalled()
})
