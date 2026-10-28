import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"
import { saveModelAlias } from "@/lib/model-aliases"

import { ModelAliasSettings } from "../model-alias-settings"

const id = "gateway:alwith-managed-litellm:deepseek-V4.1-flash"
vi.mock("@/lib/model-aliases", () => ({
  saveModelAlias: vi.fn(),
  useModelAliases: () => ({ "gateway:alwith-managed-litellm:deepseek-V4.1-flash": "My DeepSeek" })
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
const providers = [
  {
    id: "alwith-managed-litellm",
    name: "ALwith",
    baseUrl: "https://gateway.example/v1",
    models: [{ api_id: "deepseek-V4.1-flash", label: "Account name" }]
  }
]

beforeAll(async () => {
  await initI18n("en")
})
beforeEach(() => {
  vi.mocked(saveModelAlias).mockReset().mockResolvedValue()
  vi.mocked(toast.error).mockClear()
})

test("alias editor is collapsed until requested and clearing saves the original model identity", async () => {
  const view = render(<ModelAliasSettings providers={providers} />)
  expect(view.queryByRole("textbox")).not.toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Model aliases" }))
  const input = await view.findByRole("textbox", { name: "Account name" })
  expect(input).toHaveValue("My DeepSeek")
  fireEvent.change(input, { target: { value: "" } })
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(saveModelAlias).toHaveBeenCalledWith(id, "")
})

test("failed alias saves retain the draft and show an error", async () => {
  vi.mocked(saveModelAlias).mockRejectedValue(new Error("Settings changed"))
  const view = render(<ModelAliasSettings providers={providers} />)
  fireEvent.click(view.getByRole("button", { name: "Model aliases" }))
  const input = await view.findByRole("textbox", { name: "Account name" })
  fireEvent.change(input, { target: { value: "New alias" } })
  fireEvent.click(view.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Settings changed"))
  expect(input).toHaveValue("New alias")
  expect(view.getByRole("button", { name: "Save" })).toBeEnabled()
})
