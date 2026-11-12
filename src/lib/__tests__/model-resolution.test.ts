import { expect, test, vi } from "vitest"

import { resolveConfiguredModel } from "../model-resolution"
import type { ProviderSnapshot } from "../providers"
import { gatewayModelId } from "../providers"

const empty: ProviderSnapshot = {
  revision: 1,
  appliedRevision: 1,
  status: "applied",
  error: null,
  providers: {},
  customProviders: []
}
const company = {
  id: "custom_alwith_enterprise_a",
  name: "Company",
  baseUrl: "https://company.test",
  models: [{ api_id: "model", label: "Model" }]
}
test("native selections never consult either catalog", async () => {
  const sources = { shared: vi.fn(), enterprise: vi.fn() }
  expect(await resolveConfiguredModel("gpt-6-sol", "session", sources)).toBe("gpt-6-sol")
  expect(sources.shared).not.toHaveBeenCalled()
  expect(sources.enterprise).not.toHaveBeenCalled()
})
test("ordinary selections never consult a failed enterprise source", async () => {
  const sources = {
    shared: vi.fn(async () => ({ ...empty, managedProviders: [{ ...company, id: "litellm" }] })),
    enterprise: vi.fn(async () => {
      throw Error("unreachable")
    })
  }
  expect(await resolveConfiguredModel("gateway:litellm:model", "session", sources)).toBe("gateway:litellm:model")
  expect(sources.enterprise).not.toHaveBeenCalled()
})
test("enterprise selections ignore ordinary configuration failures", async () => {
  const sources = {
    shared: vi.fn(async () => {
      throw Error("ordinary unavailable")
    }),
    enterprise: vi.fn(async () => company)
  }
  const model = gatewayModelId(company.id, "model")
  expect(await resolveConfiguredModel(model, "session", sources)).toBe(model)
  expect(sources.shared).not.toHaveBeenCalled()
})
test("an enterprise read failure never replaces an explicit draft selection", async () => {
  const sources = {
    shared: vi.fn(async () => empty),
    enterprise: vi.fn(async () => {
      throw Error("catalog offline")
    })
  }
  await expect(resolveConfiguredModel(gatewayModelId(company.id, "model"), "draft", sources)).rejects.toThrow(
    "catalog offline"
  )
  expect(sources.shared).not.toHaveBeenCalled()
})
test("confirmed removal preserves strict sessions while drafts can use another source", async () => {
  const sources = { shared: vi.fn(async () => empty), enterprise: vi.fn(async () => null) }
  const model = gatewayModelId(company.id, "model")
  await expect(resolveConfiguredModel(model, "session", sources)).rejects.toThrow("enterprise model is unavailable")
  expect(await resolveConfiguredModel(model, "draft", sources)).toBeNull()
})
test("legacy enterprise selections migrate to current IDs", async () => {
  const sources = { shared: vi.fn(), enterprise: vi.fn(async () => company) }
  expect(await resolveConfiguredModel("gateway:finture-enterprise:model", "session", sources)).toBe(
    gatewayModelId(company.id, "model")
  )
})

test("default creation can use enterprise when the ordinary catalog fails", async () => {
  const sources = {
    shared: vi.fn(async () => {
      throw Error("shared offline")
    }),
    enterprise: vi.fn(async () => company)
  }
  const report = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await resolveConfiguredModel(null, "draft", sources)).toBe(gatewayModelId(company.id, "model"))
  } finally {
    report.mockRestore()
  }
})
test("an unavailable inherited ordinary draft can fall back to enterprise", async () => {
  const sources = { shared: vi.fn(async () => empty), enterprise: vi.fn(async () => company) }
  expect(await resolveConfiguredModel("gateway:litellm:removed", "draft", sources)).toBe(
    gatewayModelId(company.id, "model")
  )
})
test("an account change rejects a late enterprise selection", async () => {
  let identity = { id: "a" }
  let finish!: (value: typeof company) => void
  const sources = {
    account: () => identity,
    shared: vi.fn(),
    enterprise: vi.fn(
      () =>
        new Promise<typeof company>((resolve) => {
          finish = resolve
        })
    )
  }
  const selection = resolveConfiguredModel(gatewayModelId(company.id, "model"), "session", sources)
  identity = { id: "b" }
  finish(company)
  await expect(selection).rejects.toThrow("account changed")
})
