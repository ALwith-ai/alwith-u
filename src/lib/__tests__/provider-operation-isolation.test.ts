import { beforeEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), apply: vi.fn(), enterprise: vi.fn() }))
vi.mock("@alwith/module-chat/settings", async (original) => ({
  ...(await original<object>()),
  createProvidersPort: () => ({ read: host.read, save: host.save, apply: host.apply })
}))
vi.mock("@/bindings", () => ({ commands: { enterpriseCatalog: host.enterprise } }))
import { providersPort } from "../providers"

beforeEach(() => {
  vi.clearAllMocks()
  host.enterprise.mockRejectedValue(new Error("enterprise unavailable"))
})
for (const operation of ["read", "apply"] as const) {
  test(`${operation} preserves the shared result without consulting enterprise`, async () => {
    const snapshot = { revision: 7 }
    host[operation].mockResolvedValue(snapshot)
    expect(await providersPort[operation]()).toBe(snapshot)
    expect(host.enterprise).not.toHaveBeenCalled()
  })
}
test("a successful save cannot become an enterprise catalog failure", async () => {
  const snapshot = { revision: 8 }
  host.save.mockResolvedValue(snapshot)
  expect(await providersPort.save(7, "deepseek", null)).toBe(snapshot)
  expect(host.enterprise).not.toHaveBeenCalled()
})
