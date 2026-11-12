import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, expect, test, vi } from "vitest"
import { create } from "zustand"

const host = vi.hoisted(() => ({
  read: vi.fn(),
  enterprise: vi.fn(),
  changed: vi.fn(),
  listen: vi.fn(),
  error: vi.fn()
}))
vi.mock("../providers", () => ({ providersPort: { read: host.read, onChanged: host.changed } }))
vi.mock("@/bindings", () => ({ commands: { enterpriseCatalog: host.enterprise } }))
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }))
vi.mock("sonner", () => ({ toast: { error: host.error } }))
vi.mock("@/features/auth/store", () => ({ usePlatformAuth: auth }))
const auth = create<{ user: { user_uuid: string } | null }>(() => ({ user: { user_uuid: "a" } }))
const { initI18n } = await import("../i18n")
beforeAll(async () => {
  await initI18n("zh-CN")
})
const { useModelCatalog } = await import("../use-model-catalog")
const shared = { revision: 9, appliedRevision: 9, status: "applied", error: null, providers: {}, customProviders: [] }
const company = {
  id: "custom_alwith_enterprise_a",
  name: "Company",
  baseUrl: "https://company.test",
  models: [{ api_id: "model", label: "Model" }]
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.setState({ user: { user_uuid: "a" } })
  host.read.mockReset().mockResolvedValue(shared)
  host.enterprise.mockReset().mockResolvedValue(company)
  host.changed.mockResolvedValue(() => {})
  host.listen.mockResolvedValue(() => {})
})
test("ordinary catalog publishes while enterprise is still pending", async () => {
  host.enterprise.mockReturnValue(new Promise(() => {}))
  const view = renderHook(useModelCatalog)
  await waitFor(() => expect(view.result.current.shared.status).toBe("ready"))
  expect(view.result.current.snapshot?.revision).toBe(9)
  expect(view.result.current.enterprise.status).toBe("loading")
})
test("enterprise catalog remains visible when ordinary catalog fails", async () => {
  host.read.mockRejectedValue(Error("ordinary offline"))
  const view = renderHook(useModelCatalog)
  await waitFor(() => expect(view.result.current.enterprise.status).toBe("ready"))
  expect(view.result.current.snapshot?.managedProviders).toEqual([company])
  await waitFor(() => expect(view.result.current.shared.status).toBe("error"))
  expect(host.error).toHaveBeenCalledWith("ordinary offline")
})
test("enterprise failure preserves the ordinary source revision and error", async () => {
  host.enterprise.mockRejectedValue(Error("enterprise offline"))
  const view = renderHook(useModelCatalog)
  await waitFor(() => expect(view.result.current.enterprise.status).toBe("error"))
  expect(view.result.current.snapshot?.revision).toBe(9)
  expect(view.result.current.snapshot?.error).toBeNull()
  expect(host.error).toHaveBeenCalledWith("暂时无法更新网关模型列表")
})
test("changing accounts discards old data and late responses", async () => {
  let release!: (value: typeof company) => void
  host.enterprise.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    })
  )
  const view = renderHook(useModelCatalog)
  await waitFor(() => expect(view.result.current.shared.status).toBe("ready"))
  host.read.mockResolvedValue({ ...shared, revision: 1 })
  host.enterprise.mockResolvedValue(null)
  await act(async () => {
    auth.setState({ user: { user_uuid: "b" } })
  })
  await waitFor(() => expect(view.result.current.enterprise.status).toBe("ready"))
  await act(async () => release(company))
  expect(view.result.current.enterprise.data).toBeNull()
  expect(view.result.current.snapshot?.revision).toBe(1)
})

test("same-account refresh failure retains the last enterprise menu with an unconfirmed label", async () => {
  let changed!: () => void
  host.listen.mockImplementation(async (_event: string, handler: () => void) => {
    changed = handler
    return () => {}
  })
  const view = renderHook(useModelCatalog)
  await waitFor(() => expect(view.result.current.enterprise.status).toBe("ready"))
  host.enterprise.mockRejectedValue(Error("offline"))
  await act(async () => changed())
  await waitFor(() => expect(view.result.current.enterprise.status).toBe("error"))
  expect(view.result.current.enterprise.data).toEqual(company)
  expect(view.result.current.snapshot?.managedProviders?.[0]?.name).toBe("Company (模型列表更新失败)")
})
