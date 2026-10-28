import { act, type BoundFunctions, fireEvent, type queries, render, within } from "@testing-library/react"
import { toast } from "sonner"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"
import {
  applyProvidersWhenIdle,
  type CustomProviderInput,
  type ProviderSnapshot,
  saveCustomProvider
} from "@/lib/providers"
import { useProviders } from "@/lib/use-providers"

import { ProviderSection } from "../provider-section"

vi.mock("@/lib/use-providers", () => ({ useProviders: vi.fn() }))
vi.mock("../codex-provider-section", () => ({ CodexProviderSection: () => null }))
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  applyProvidersWhenIdle: vi.fn(),
  saveCustomProvider: vi.fn()
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

beforeAll(async () => {
  await initI18n("en")
})

beforeEach(() => {
  let snapshot: ProviderSnapshot = {
    revision: 0,
    appliedRevision: 0,
    status: "applied",
    error: null,
    providers: {},
    customProviders: []
  }
  vi.mocked(useProviders).mockImplementation(() => snapshot)
  vi.mocked(saveCustomProvider)
    .mockReset()
    .mockImplementation((revision, input) => {
      return Promise.try(() => {
        expect(revision).toBe(snapshot.revision)
        if (!input.id) throw new Error("Missing provider ID")
        const provider = { id: input.id, name: input.name, baseUrl: input.baseUrl, models: input.models }
        snapshot = {
          ...snapshot,
          revision: revision + 1,
          customProviders: [...snapshot.customProviders.filter((item) => item.id !== input.id), provider]
        }
        return snapshot
      })
    })
})

type Scope = BoundFunctions<typeof queries>

function visibleEditor(view: ReturnType<typeof render>): Scope {
  const input = view.getAllByLabelText("Provider name").find((element) => !element.closest("[hidden]"))
  const editor = input?.closest(".space-y-5")
  if (!(editor instanceof HTMLElement)) throw new Error("Provider editor missing")
  return within(editor)
}

function providerTabs(view: ReturnType<typeof render>): Scope {
  const tabs = view.getByRole("heading", { name: "Other models" }).parentElement
  if (!tabs) throw new Error("Provider tabs missing")
  return within(tabs)
}

async function fillProvider(editor: Scope, name: string): Promise<void> {
  await act(() => {
    return Promise.try(() => {
      for (const [label, value] of [
        ["Provider name", name],
        ["API base URL", `https://${name.toLowerCase()}.example.test/v1`],
        ["API key", `key-${name}`]
      ]) {
        const input = editor.getByLabelText(label)
        input.focus()
        fireEvent.input(input, { target: { value } })
        fireEvent.keyUp(input, { key: "a" })
      }
    })
  })
}

test("successive custom providers get independent IDs and existing providers remain editable", async () => {
  const view = render(<ProviderSection />)
  const tabs = providerTabs(view)
  for (const name of ["First", "Second", "Third"]) {
    await act(() => Promise.try(() => fireEvent.click(tabs.getByText("Custom", { selector: "span" }))))
    const editor = visibleEditor(view)
    await fillProvider(editor, name)
    await act(() => Promise.try(() => fireEvent.click(editor.getByText("Save", { selector: "button" }))))
  }
  const inputs: CustomProviderInput[] = vi.mocked(saveCustomProvider).mock.calls.map(([, input]) => input)
  expect(new Set(inputs.map((input) => input.id)).size).toBe(3)
  for (const name of ["First", "Second", "Third"]) {
    await act(() => Promise.try(() => fireEvent.click(tabs.getByText(name, { selector: "span" }))))
    expect(visibleEditor(view).getByLabelText("Provider name")).toHaveValue(name)
  }
  await fillProvider(visibleEditor(view), "Updated")
  await act(() => Promise.try(() => fireEvent.click(visibleEditor(view).getByText("Save", { selector: "button" }))))
  expect(vi.mocked(saveCustomProvider).mock.calls[3]?.[1].id).toBe(inputs[2]?.id)
  expect(tabs.getByRole("button", { name: "First" })).toBeVisible()
  expect(tabs.getByRole("button", { name: "Second" })).toBeVisible()
  expect(tabs.getByRole("button", { name: "Updated" })).toBeVisible()
})

test("a failed save and switching tabs preserve the new provider draft", async () => {
  vi.mocked(saveCustomProvider).mockRejectedValueOnce(new Error("Save failed"))
  const view = render(<ProviderSection />)
  const tabs = providerTabs(view)
  await act(() => Promise.try(() => fireEvent.click(tabs.getByText("Custom", { selector: "span" }))))
  await fillProvider(visibleEditor(view), "Draft")
  await act(() => Promise.try(() => fireEvent.click(visibleEditor(view).getByText("Save", { selector: "button" }))))
  await act(() => Promise.try(() => fireEvent.click(tabs.getByText("DeepSeek", { selector: "span" }))))
  await act(() => Promise.try(() => fireEvent.click(tabs.getByText("Custom", { selector: "span" }))))
  expect(visibleEditor(view).getByLabelText("Provider name")).toHaveValue("Draft")
  expect(visibleEditor(view).getByLabelText("API key")).toHaveValue("key-Draft")
  await act(() => Promise.try(() => fireEvent.click(visibleEditor(view).getByText("Save", { selector: "button" }))))
  const calls = vi.mocked(saveCustomProvider).mock.calls
  expect(calls[1]?.[1]).toEqual(calls[0]?.[1])
  await act(() => Promise.try(() => fireEvent.click(tabs.getByText("Custom", { selector: "span" }))))
  expect(visibleEditor(view).getByLabelText("Provider name")).toHaveValue("")
  expect(visibleEditor(view).getByLabelText("API key")).toHaveValue("")
})

test("pending catalog exposes an explicit retry action", async () => {
  vi.mocked(useProviders).mockReturnValue({
    revision: 2,
    appliedRevision: 1,
    status: "pending",
    error: null,
    providers: {},
    customProviders: []
  })
  const view = render(<ProviderSection />)
  vi.mocked(applyProvidersWhenIdle).mockResolvedValue({
    revision: 2,
    appliedRevision: 1,
    status: "pending",
    error: null,
    providers: {},
    customProviders: []
  })
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Retry" }))))
  expect(applyProvidersWhenIdle).toHaveBeenCalledTimes(1)
  expect(toast.info).toHaveBeenCalledWith(
    "Settings saved. Remaining changes apply when chats using the affected providers finish."
  )
  expect(view.getByRole("button", { name: "Retry" })).toBeEnabled()
})

test("saving a pending custom provider reports that it is not applied yet", async () => {
  vi.mocked(saveCustomProvider).mockResolvedValueOnce({
    revision: 1,
    appliedRevision: 0,
    status: "pending",
    error: null,
    providers: {},
    customProviders: []
  })
  const view = render(<ProviderSection />)
  await act(() => Promise.try(() => fireEvent.click(providerTabs(view).getByText("Custom", { selector: "span" }))))
  await fillProvider(visibleEditor(view), "Pending")
  await act(() => Promise.try(() => fireEvent.click(visibleEditor(view).getByText("Save", { selector: "button" }))))
  expect(toast.success).toHaveBeenLastCalledWith(
    "Settings saved. Remaining changes apply when chats using the affected providers finish."
  )
})

test("retry failure remains actionable and releases the busy state", async () => {
  vi.mocked(useProviders).mockReturnValue({
    revision: 2,
    appliedRevision: 1,
    status: "failed",
    error: "Catalog unavailable",
    providers: {},
    customProviders: []
  })
  vi.mocked(applyProvidersWhenIdle).mockRejectedValueOnce(new Error("Still unavailable"))
  const view = render(<ProviderSection />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Retry" }))))
  expect(toast.error).toHaveBeenLastCalledWith("Still unavailable")
  expect(view.getByRole("button", { name: "Retry" })).toBeEnabled()
})
