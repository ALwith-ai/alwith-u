import { beforeEach, expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({ bind: vi.fn(), refresh: vi.fn(), clear: vi.fn(), status: vi.fn() }))
vi.mock("@/bindings", () => ({
  commands: {
    enterpriseBind: native.bind,
    enterpriseRefresh: native.refresh,
    enterpriseClear: native.clear,
    enterpriseStatus: native.status
  }
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { createEnterpriseModels, enterpriseModelLabels } from "../enterprise-models"

beforeEach(() => {
  vi.clearAllMocks()
  native.bind.mockResolvedValue(3)
  native.refresh.mockResolvedValue(null)
  native.clear.mockResolvedValue(null)
})

function fixture() {
  const host = {
    environment: "production" as const,
    labels: vi.fn<() => Promise<Record<string, string> | null>>(async () => ({
      "deepseek-V4.1-flash": "企业内部模型123"
    })),
    account: () => "alice" as string | null,
    email: () => "alice@alwith.example" as string | null,
    validate: vi.fn(async () => {}),
    authenticated: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => {})
  }
  return { host, models: createEnterpriseModels(host) }
}

test("enterprise preparation passes association metadata without requesting ALwith credentials", async () => {
  const { host, models } = fixture()
  await models.refresh()
  expect(native.bind).toHaveBeenCalledWith({
    account: {
      environment: "production",
      userUuid: "alice",
      email: "alice@alwith.example"
    }
  })
  expect(native.refresh).toHaveBeenCalledWith({
    account: expect.objectContaining({ email: "alice@alwith.example" }),
    generation: 3,
    modelLabels: { "deepseek-V4.1-flash": "企业内部模型123" }
  })
  expect(host.validate).not.toHaveBeenCalled()
  expect(host.authenticated).not.toHaveBeenCalled()
  expect(host.refreshProfile).not.toHaveBeenCalled()
})

test("an absent platform account or email cannot begin enterprise preparation", async () => {
  const { host, models } = fixture()
  host.account = () => null
  await expect(models.refresh()).rejects.toThrow("Sign in")
  host.account = () => "alice"
  host.email = () => null
  await expect(models.refresh()).rejects.toThrow("email")
  expect(native.bind).not.toHaveBeenCalled()
})

test("account replacement during native binding cannot refresh the old enterprise session", async () => {
  const { host, models } = fixture()
  native.bind.mockImplementationOnce(async () => {
    host.account = () => "bob"
    return 3
  })
  await expect(models.refresh()).rejects.toThrow("account changed")
  expect(native.refresh).not.toHaveBeenCalled()
})

test("platform model labels come from the configured enterprise provider", () => {
  expect(
    enterpriseModelLabels({
      provider_id: "finture-enterprise",
      models: [{ api_id: "deepseek-V4.1-flash", label: "企业内部模型123" }]
    })
  ).toEqual({ "deepseek-V4.1-flash": "企业内部模型123" })
  expect(() => enterpriseModelLabels({ provider_id: "litellm", models: [] })).toThrow()
  expect(() =>
    enterpriseModelLabels({ provider_id: "finture-enterprise", models: [{ api_id: "deepseek-V4.1-flash", label: "" }] })
  ).toThrow()
})

test("account replacement while loading labels cannot apply old metadata", async () => {
  const { host, models } = fixture()
  host.labels.mockImplementationOnce(async () => {
    host.account = () => "bob"
    return { "deepseek-V4.1-flash": "Previous account" }
  })
  await expect(models.refresh()).rejects.toThrow("account changed")
  expect(native.refresh).not.toHaveBeenCalled()
})

test("a presentation outage preserves cached labels without blocking gateway preparation", async () => {
  const { host, models } = fixture()
  await models.refresh()
  host.labels.mockResolvedValueOnce(null)
  await models.refresh()
  expect(native.refresh).toHaveBeenLastCalledWith(
    expect.objectContaining({
      modelLabels: { "deepseek-V4.1-flash": "企业内部模型123" }
    })
  )
})

test("an initial presentation outage does not prevent gateway login preparation", async () => {
  const { host, models } = fixture()
  host.labels.mockResolvedValueOnce(null)
  await models.refresh()
  expect(native.refresh).toHaveBeenCalledWith(expect.objectContaining({ modelLabels: {} }))
})
