import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { ImageSection } from "../image-section"

const host = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { imagesReadSettings: host.read, imagesSaveSettings: host.save } }))
beforeAll(() => initI18n("en"))
beforeEach(() => {
  vi.clearAllMocks()
  let current = {
    revision: 1,
    baseUrl: "",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    configured: false
  }
  host.read.mockImplementation(async () => current)
  host.save.mockImplementation(async ({ input }: { input: { baseUrl: string; apiKey: string | null } }) => {
    current = {
      ...current,
      revision: current.revision + 1,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      configured: input.apiKey === null ? current.configured : input.apiKey !== ""
    }
    return current
  })
})

test("image credentials are saved and removed through the native settings boundary", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  const input = screen.getByLabelText("Seedream API key", { selector: "input" })
  const addressToggle = screen.getByRole("button", { name: "API base URL" })
  expect(addressToggle).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByLabelText("API base URL", { selector: "input" })).toBeNull()
  fireEvent.click(addressToggle)
  const baseUrl = screen.getByLabelText("API base URL", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  expect(input).toHaveAttribute("type", "password")
  fireEvent.change(baseUrl, { target: { value: "https://gateway.example/v1/" } })
  fireEvent.change(input, { target: { value: " image-test-key " } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenCalledWith({
      input: { baseUrl: "https://gateway.example/v1/", apiKey: "image-test-key", expectedRevision: 1 }
    })
  )
  await waitFor(() => expect(input).toHaveValue(""))
  expect(input).toHaveAttribute("placeholder", "Configured · enter a new key to replace")
  expect(baseUrl).toHaveValue("https://gateway.example/v1")
  fireEvent.change(baseUrl, { target: { value: "https://gateway.example/api/v3" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenLastCalledWith({
      input: { baseUrl: "https://gateway.example/api/v3", apiKey: null, expectedRevision: 2 }
    })
  )
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenLastCalledWith({
      input: { baseUrl: "https://gateway.example/api/v3", apiKey: "", expectedRevision: 3 }
    })
  )
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull())
})

test("failed credential saves preserve the draft and allow a retry", async () => {
  host.save.mockRejectedValueOnce(new Error("Credential storage unavailable"))
  render(<ImageSection onOpenModels={vi.fn()} />)
  const input = screen.getByLabelText("Seedream API key", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: "image-test-key" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Credential storage unavailable")
  expect(input).toHaveValue("image-test-key")
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
})
