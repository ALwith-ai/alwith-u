import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { toast } from "sonner"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { ImageSection } from "../image-section"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const host = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  generate: vi.fn(),
  testKey: vi.fn(),
  changed: new Set<() => void>()
}))
vi.mock("@/lib/open", () => ({ openExternal: host.open }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: () => void) => {
    host.changed.add(handler)
    return () => host.changed.delete(handler)
  },
  emit: async () => {
    for (const handler of host.changed) handler()
  }
}))
vi.mock("@/bindings", () => ({
  commands: {
    imagesReadSettings: host.read,
    imagesSaveSettings: host.save,
    imagesGenerate: host.generate,
    imagesTestKey: host.testKey
  }
}))
beforeAll(() => initI18n("en"))
beforeEach(() => {
  vi.clearAllMocks()
  host.changed.clear()
  host.generate.mockReset().mockResolvedValue({ images: [{ mimeType: "image/png", data: "test" }] })
  host.testKey.mockReset().mockResolvedValue({ ok: true, code: "ok", message: "", status: 200, latencyMs: 10 })
  host.open.mockResolvedValue(undefined)
  let revision = 1
  const connections = {
    seedream: {
      region: null,
      baseUrl: "",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      configured: false
    },
    minimax: { region: "cn", baseUrl: "", defaultBaseUrl: "https://api.minimax.cn/v1", configured: false }
  }
  type Provider = keyof typeof connections
  host.read.mockImplementation(async ({ provider }: { provider: Provider }) => ({ ...connections[provider], revision }))
  host.save.mockImplementation(
    async ({ input }: { input: { provider: Provider; baseUrl: string; apiKey: string | null; region?: string } }) => {
      const current = connections[input.provider]
      const next = {
        ...current,
        region: input.region ?? current.region,
        baseUrl: input.baseUrl.replace(/\/+$/, ""),
        configured: input.apiKey === null ? current.configured : input.apiKey !== ""
      }
      Object.assign(current, next)
      return { ...next, revision: ++revision }
    }
  )
})

test("image credentials are saved and removed through the native settings boundary", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  const form = within(screen.getByRole("form", { name: "Seedream" }))
  const input = screen.getByLabelText("Seedream API key", { selector: "input" })
  const addressToggle = form.getByRole("button", { name: "API base URL" })
  expect(addressToggle).toHaveAttribute("aria-expanded", "false")
  expect(form.queryByLabelText("API base URL", { selector: "input" })).toBeNull()
  fireEvent.click(addressToggle)
  const baseUrl = form.getByLabelText("API base URL", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  expect(input).toHaveAttribute("type", "password")
  expect(form.getByText("Not configured.")).toBeInTheDocument()
  fireEvent.change(baseUrl, { target: { value: "https://gateway.example/v1/" } })
  fireEvent.change(input, { target: { value: " image-test-key " } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenCalledWith({
      input: {
        provider: "seedream",
        baseUrl: "https://gateway.example/v1/",
        apiKey: "image-test-key",
        expectedRevision: 1
      }
    })
  )
  await waitFor(() => expect(input).toHaveValue(""))
  expect(input).toHaveAttribute("placeholder", "A key is saved; enter a new one to replace it")
  expect(baseUrl).toHaveValue("https://gateway.example/v1")
  expect(await form.findByText("2 models available. Select them in each chat's model picker.")).toBeInTheDocument()
  fireEvent.change(baseUrl, { target: { value: "https://gateway.example/api/v3" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenLastCalledWith({
      input: { provider: "seedream", baseUrl: "https://gateway.example/api/v3", apiKey: null, expectedRevision: 2 }
    })
  )
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.click(form.getByRole("button", { name: "Remove" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenLastCalledWith({
      input: { provider: "seedream", baseUrl: "", apiKey: "", expectedRevision: 3 }
    })
  )
  await waitFor(() => expect(form.queryByRole("button", { name: "Remove" })).toBeNull())
  expect(await form.findByText("Not configured.")).toBeInTheDocument()
})

test("failed credential saves preserve the draft and allow a retry", async () => {
  host.save.mockRejectedValueOnce(new Error("Credential storage unavailable"))
  render(<ImageSection onOpenModels={vi.fn()} />)
  const form = within(screen.getByRole("form", { name: "Seedream" }))
  const input = screen.getByLabelText("Seedream API key", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { value: "image-test-key" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Credential storage unavailable")
  expect(input).toHaveValue("image-test-key")
  expect(form.getByRole("button", { name: "Save" })).toBeEnabled()
})

test("MiniMax uses its own credential configuration", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const input = form.getByLabelText("MiniMax API key", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  expect(host.read).toHaveBeenCalledWith({ provider: "minimax" })
  fireEvent.change(input, { target: { value: "minimax-test-key" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenCalledWith({
      input: { provider: "minimax", region: "cn", baseUrl: "", apiKey: "minimax-test-key", expectedRevision: 1 }
    })
  )
})

test("a stale provider save keeps its draft and can retry with the current shared revision", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const input = form.getByLabelText("MiniMax API key", { selector: "input" })
  await waitFor(() => expect(input).toBeEnabled())
  host.save.mockRejectedValueOnce(new Error("Settings changed"))
  host.read.mockResolvedValue({
    revision: 2,
    region: "cn",
    configured: false,
    baseUrl: "",
    defaultBaseUrl: "https://api.minimax.cn/v1"
  })
  fireEvent.change(input, { target: { value: "minimax-key" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  expect(await form.findByRole("alert")).toHaveTextContent("Settings changed")
  await waitFor(() => expect(form.getByRole("button", { name: "Save" })).toBeEnabled())
  expect(input).toHaveValue("minimax-key")
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenLastCalledWith({
      input: { provider: "minimax", region: "cn", baseUrl: "", apiKey: "minimax-key", expectedRevision: 2 }
    })
  )
})

test("provider switching shows one panel, preserves drafts, and updates its saved status", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  const seedreamTab = screen.getByRole("button", { name: "Seedream" })
  const minimaxTab = screen.getByRole("button", { name: "MiniMax" })
  expect(seedreamTab).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryByRole("form", { name: "MiniMax" })).toBeNull()
  const seedream = screen.getByLabelText("Seedream API key", { selector: "input" })
  await waitFor(() => expect(seedream).toBeEnabled())
  fireEvent.change(seedream, { target: { value: "unsaved-seedream-key" } })
  fireEvent.click(minimaxTab)
  expect(minimaxTab).toHaveAttribute("aria-pressed", "true")
  expect(screen.queryByRole("form", { name: "Seedream" })).toBeNull()
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  fireEvent.change(form.getByLabelText("MiniMax API key", { selector: "input" }), {
    target: { value: "minimax-key" }
  })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(screen.getByTestId("image-minimax-status")).toHaveAttribute("data-configured", "true"))
  fireEvent.click(seedreamTab)
  expect(screen.getByLabelText("Seedream API key", { selector: "input" })).toHaveValue("unsaved-seedream-key")
})

test("MiniMax region changes its default endpoint and is saved with the connection", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const region = form.getByRole("combobox", { name: "Region" })
  await waitFor(() => expect(region).toBeEnabled())
  expect(region).toHaveTextContent("China")
  fireEvent.click(form.getByRole("button", { name: "API base URL" }))
  const baseUrl = form.getByLabelText("API base URL", { selector: "input" })
  expect(baseUrl).toHaveAttribute("placeholder", "https://api.minimax.cn/v1")
  fireEvent.change(baseUrl, { target: { value: "https://old-gateway.example/v1" } })
  fireEvent.click(region)
  fireEvent.keyDown(await screen.findByRole("option", { name: "International" }), { key: "Enter" })
  expect(baseUrl).toHaveValue("")
  expect(baseUrl).toHaveAttribute("placeholder", "https://api.minimax.io/v1")
  fireEvent.change(form.getByLabelText("MiniMax API key", { selector: "input" }), {
    target: { value: "international-key" }
  })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(host.save).toHaveBeenCalledWith({
      input: { provider: "minimax", region: "intl", baseUrl: "", apiKey: "international-key", expectedRevision: 1 }
    })
  )
  await waitFor(() => expect(form.getByRole("button", { name: "Save" })).toBeDisabled())
  expect(region).toHaveTextContent("International")
})

test("initial settings failures offer a retry without leaving the form disabled", async () => {
  host.read.mockRejectedValueOnce(new Error("Settings unavailable"))
  render(<ImageSection onOpenModels={vi.fn()} />)
  const form = within(screen.getByRole("form", { name: "Seedream" }))
  expect(await form.findByRole("alert")).toHaveTextContent("Settings unavailable")
  expect(form.getByLabelText("Seedream API key", { selector: "input" })).toBeDisabled()
  fireEvent.click(form.getByRole("button", { name: "Retry" }))
  await waitFor(() => expect(form.getByLabelText("Seedream API key", { selector: "input" })).toBeEnabled())
  expect(form.queryByRole("alert")).toBeNull()
})

test("key visibility and Enter save follow provider settings and lock both panels while saving", async () => {
  const receipt = Promise.withResolvers<{
    revision: number
    region: null
    configured: boolean
    baseUrl: string
    defaultBaseUrl: string
  }>()
  host.save.mockReturnValueOnce(receipt.promise)
  render(<ImageSection onOpenModels={vi.fn()} />)
  const form = within(screen.getByRole("form", { name: "Seedream" }))
  const key = form.getByLabelText("Seedream API key", { selector: "input" })
  await waitFor(() => expect(key).toBeEnabled())
  fireEvent.change(key, { target: { value: "private-draft" } })
  fireEvent.click(form.getByRole("button", { name: "Show key" }))
  expect(key).toHaveAttribute("type", "text")
  expect(host.save).not.toHaveBeenCalled()
  fireEvent.keyDown(key, { key: "Enter" })
  expect(host.save).toHaveBeenCalledTimes(1)
  expect(key).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const minimax = within(screen.getByRole("form", { name: "MiniMax" }))
  expect(minimax.getByLabelText("MiniMax API key", { selector: "input" })).toBeDisabled()
  expect(minimax.getByRole("combobox", { name: "Region" })).toBeDisabled()
  await act(async () =>
    receipt.resolve({
      revision: 2,
      region: null,
      configured: true,
      baseUrl: "",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3"
    })
  )
  fireEvent.click(screen.getByRole("button", { name: "Seedream" }))
  expect(key).toHaveValue("")
  expect(key).toHaveAttribute("type", "password")
  expect(form.getByRole("button", { name: "Save" })).toBeDisabled()
})

test("provider change events update status without overwriting an unsaved draft", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  const key = screen.getByLabelText("Seedream API key", { selector: "input" })
  await waitFor(() => expect(key).toBeEnabled())
  fireEvent.change(key, { target: { value: "unsaved" } })
  host.read.mockResolvedValue({
    revision: 5,
    region: null,
    configured: true,
    baseUrl: "https://new.example/v1",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  })
  await act(async () => {
    for (const handler of host.changed) handler()
  })
  expect(screen.getByTestId("image-seedream-status")).toHaveAttribute("data-configured", "true")
  expect(
    within(screen.getByRole("form", { name: "Seedream" })).getByText(
      "2 models available. Select them in each chat's model picker."
    )
  ).toBeInTheDocument()
  expect(key).toHaveValue("unsaved")
})

test("MiniMax header stays minimal and the key link follows the selected region", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const region = form.getByRole("combobox", { name: "Region" })
  await waitFor(() => expect(region).toBeEnabled())
  expect(form.queryByText(/MiniMax H3 Image/)).toBeNull()
  expect(form.queryByText("Configured", { exact: true })).toBeNull()
  const link = form.getByRole("button", { name: "Get an API key from MiniMax" })
  fireEvent.click(link)
  expect(host.open).toHaveBeenLastCalledWith("https://platform.minimax.cn/user-center/basic-information/interface-key")
  fireEvent.click(region)
  fireEvent.keyDown(await screen.findByRole("option", { name: "International" }), { key: "Enter" })
  fireEvent.click(link)
  expect(host.open).toHaveBeenLastCalledWith("https://platform.minimax.io/user-center/basic-information/interface-key")
  expect(host.save).not.toHaveBeenCalled()
})

test("removing a provider resets unsaved connection edits and clears its status", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const key = form.getByLabelText("MiniMax API key", { selector: "input" })
  await waitFor(() => expect(key).toBeEnabled())
  fireEvent.change(key, { target: { value: "saved-key" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(form.getByRole("button", { name: "Remove" })).toBeEnabled())
  fireEvent.change(key, { target: { value: "unsaved-replacement" } })
  fireEvent.click(form.getByRole("button", { name: "API base URL" }))
  const address = form.getByLabelText("API base URL", { selector: "input" })
  fireEvent.change(address, { target: { value: "https://unsaved.example/v1" } })
  fireEvent.click(form.getByRole("combobox", { name: "Region" }))
  fireEvent.keyDown(await screen.findByRole("option", { name: "International" }), { key: "Enter" })
  fireEvent.click(form.getByRole("button", { name: "Remove" }))
  await waitFor(() => expect(form.queryByRole("button", { name: "Remove" })).toBeNull())
  expect(key).toHaveValue("")
  expect(address).toHaveValue("")
  expect(form.getByRole("combobox", { name: "Region" })).toHaveTextContent("China")
  expect(screen.getByTestId("image-minimax-status")).toHaveAttribute("data-configured", "false")
})

test("image connection testing is explicit, uses saved credentials, and reports success or failure", async () => {
  render(<ImageSection onOpenModels={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "MiniMax" }))
  const form = within(screen.getByRole("form", { name: "MiniMax" }))
  const key = form.getByLabelText("MiniMax API key", { selector: "input" })
  await waitFor(() => expect(key).toBeEnabled())
  expect(form.queryByRole("button", { name: "Test connection" })).toBeNull()
  fireEvent.change(key, { target: { value: "saved-key" } })
  fireEvent.click(form.getByRole("button", { name: "Save" }))
  const testButton = await form.findByRole("button", { name: "Test connection" })
  await waitFor(() => expect(testButton).toBeEnabled())
  expect(host.generate).not.toHaveBeenCalled()
  expect(form.getByText(/without generating images/)).toBeInTheDocument()
  const pendingTest = Promise.withResolvers<unknown>()
  host.testKey.mockImplementationOnce(() => pendingTest.promise)
  fireEvent.click(testButton)
  await waitFor(() => expect(host.testKey).toHaveBeenCalledWith({ provider: "minimax" }))
  expect(host.generate).not.toHaveBeenCalled()
  expect(testButton).toHaveAttribute("aria-busy", "true")
  expect(testButton).toBeDisabled()
  expect(testButton.querySelector("[data-icon='inline-start']")).not.toBeNull()
  const saveButton = form.getByRole("button", { name: "Save" })
  expect(saveButton).toHaveAttribute("aria-busy", "false")
  expect(saveButton.querySelector("[data-icon='inline-start']")).toBeNull()
  await act(async () => pendingTest.resolve({ ok: true, code: "ok", message: "", status: 200, latencyMs: 10 }))
  await waitFor(() => expect(testButton).toHaveAttribute("aria-busy", "false"))
  expect(form.getByText("2 models available. Select them in each chat's model picker.")).toBeInTheDocument()
  expect(await form.findByRole("status")).toHaveTextContent("Connected in 10 ms")
  expect(toast.success).toHaveBeenLastCalledWith("Connected in 10 ms")
  fireEvent.change(key, { target: { value: "unsaved-key" } })
  expect(testButton).toBeDisabled()
  expect(form.queryByRole("status")).toBeNull()
  fireEvent.change(key, { target: { value: "" } })
  host.testKey.mockResolvedValueOnce({ ok: false, code: "unauthorized", message: "", status: 401, latencyMs: null })
  fireEvent.click(testButton)
  await waitFor(() => expect(form.getByRole("status")).toHaveTextContent("The API key was rejected (HTTP 401)"))
  expect(toast.error).toHaveBeenLastCalledWith("The API key was rejected")
  await waitFor(() => expect(testButton).toBeEnabled())
  host.testKey.mockRejectedValueOnce(new Error("Provider unavailable"))
  fireEvent.click(testButton)
  await waitFor(() => expect(toast.error).toHaveBeenLastCalledWith("Provider unavailable"))
  expect(form.queryByRole("status")).toBeNull()
  expect(host.generate).not.toHaveBeenCalled()
})
