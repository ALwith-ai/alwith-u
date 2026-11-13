import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"

import { type ProviderSnapshot } from "../providers"
import { useProviders } from "../use-providers"

const native = vi.hoisted(() => ({ read: vi.fn(), onChanged: vi.fn(), listen: vi.fn() }))
vi.mock("@alwith/module-chat/settings", async (original) => ({
  ...(await original<object>()),
  createProvidersPort: () => ({ read: native.read, onChanged: native.onChanged })
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }))

afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const initial: ProviderSnapshot = {
    revision: 2,
    appliedRevision: 2,
    providers: {},
    customProviders: [],
    status: "applied",
    error: null
  }
  let receive!: (value: ProviderSnapshot) => void
  let enterpriseChanged!: () => void
  native.read.mockResolvedValue(initial)
  native.onChanged.mockImplementation((listener: typeof receive) => {
    receive = listener
    return Promise.resolve(() => {})
  })
  native.listen.mockImplementation((_event: string, listener: () => void) => {
    enterpriseChanged = listener
    return Promise.resolve(() => {})
  })
  const catalog = vi.spyOn(commands, "enterpriseCatalog").mockResolvedValue(null)
  let renders = 0
  const view = renderHook(() => {
    renders++
    return useProviders()
  })
  await waitFor(() => expect(view.result.current?.status).toBe("applied"))
  const send = async (value: ProviderSnapshot): Promise<void> => {
    await act(() => Promise.try(() => receive(value)))
  }
  return { initial, view, send, catalog, enterpriseChanged, renders: () => renders }
}

test("identical native provider notifications do not repeatedly render consumers", async () => {
  const f = await fixture()
  await f.send(structuredClone(f.initial))
  const value = f.view.result.current
  const renders = f.renders()
  for (let index = 0; index < 10; index++) await f.send(structuredClone(f.initial))
  expect(f.view.result.current).toBe(value)
  expect(f.renders()).toBe(renders)
  f.view.unmount()
})

test("same-revision application status, errors and enterprise models still reach consumers", async () => {
  const f = await fixture()
  await f.send({ ...f.initial, appliedRevision: null, status: "pending" })
  expect(f.view.result.current?.status).toBe("pending")
  await f.send(f.initial)
  expect(f.view.result.current?.appliedRevision).toBe(2)
  await f.send({ ...f.initial, status: "failed", error: "Catalog unavailable" })
  expect(f.view.result.current?.error).toBe("Catalog unavailable")
  f.catalog.mockResolvedValue({
    id: "custom_alwith_enterprise_team",
    name: "Team",
    baseUrl: "https://example.test/v1",
    models: [{ api_id: "team-model", label: "Team model" }]
  })
  await act(() => Promise.try(() => f.enterpriseChanged()))
  expect(f.view.result.current?.managedProviders?.[0]?.models[0]?.api_id).toBe("team-model")
  f.view.unmount()
})
