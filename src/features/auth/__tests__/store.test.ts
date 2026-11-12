import type { EventCallback } from "@tauri-apps/api/event"
import { beforeEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  listeners: new Map<string, Set<EventCallback<unknown>>>(),
  request: vi.fn(),
  identifier: vi.fn(),
  platform: vi.fn(),
  bind: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
  errors: vi.fn(),
  enterpriseBind: vi.fn(),
  enterpriseRefresh: vi.fn(),
  enterpriseClear: vi.fn(),
  enterpriseStatus: vi.fn(),
  enterpriseUpdateAccount: vi.fn()
}))
vi.mock("@/lib/app-env", () => ({ appEnv: { apiBaseUrl: "https://api.example.test/service" } }))
vi.mock("@/lib/store", () => ({
  openStore: () => ({
    get: async (key: string) => host.values.get(key),
    set: async (key: string, value: unknown) => {
      host.values.set(key, value)
    },
    delete: async (key: string) => {
      host.values.delete(key)
    }
  })
}))
vi.mock("@alwith/module-auth/transport", () => ({
  createAuthTransport: () => ({
    request: host.request,
    authenticated: async (action: (token: string) => Promise<void>) => action("test-access"),
    invalidate: async () => {}
  })
}))
vi.mock("@alwith/module-auth/tauri", () => ({ createTauriAuthRefresh: () => vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier: host.identifier }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))
vi.mock("@tauri-apps/plugin-os", () => ({ arch: () => "aarch64", platform: host.platform }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }))
vi.mock("@tauri-apps/api/event", () => {
  const emit = async (name: string, payload: unknown) => {
    for (const handler of host.listeners.get(name) ?? []) handler({ event: name, id: 0, payload })
  }
  return {
    emit,
    emitTo: async (_target: unknown, name: string, payload: unknown) => emit(name, payload),
    listen: async (name: string, handler: EventCallback<unknown>) => {
      const handlers = host.listeners.get(name) ?? new Set()
      handlers.add(handler)
      host.listeners.set(name, handlers)
      return () => {
        handlers.delete(handler)
      }
    }
  }
})
vi.mock("@alwith/module-chat/settings", async (original) => ({
  ...(await original<object>()),
  createManagedProvidersPort: () => ({ bind: host.bind, refresh: host.refresh, clear: host.clear })
}))
vi.mock("@/bindings", () => ({
  commands: {
    enterpriseBind: host.enterpriseBind,
    enterpriseRefresh: host.enterpriseRefresh,
    enterpriseClear: host.enterpriseClear,
    enterpriseStatus: host.enterpriseStatus,
    enterpriseUpdateAccount: host.enterpriseUpdateAccount
  }
}))
vi.mock("sonner", () => ({ toast: { error: host.errors } }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))

const cached = { user_uuid: "account-a", nickname: "Account A", login_email: "a@example.test" }
const profile = { uuid: cached.user_uuid, nickname: cached.nickname, login_email: cached.login_email }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  host.values.clear()
  host.listeners.clear()
  host.values.set("access_token", "test-access")
  host.values.set("refresh_token", "test-refresh")
  host.values.set("user", cached)
  host.values.set("device_id", "existing-device")
  host.identifier.mockReset().mockResolvedValue("ai.alwith.u.dev")
  host.platform.mockReset().mockReturnValue("macos")
  host.request.mockReset().mockResolvedValue(profile)
  host.bind.mockReset().mockResolvedValue(1)
  host.refresh.mockReset().mockResolvedValue(undefined)
  host.clear.mockReset().mockResolvedValue(undefined)
  host.enterpriseBind.mockReset().mockResolvedValue(8)
  host.enterpriseRefresh.mockReset().mockResolvedValue(null)
  host.enterpriseClear.mockReset().mockResolvedValue(undefined)
  host.enterpriseStatus.mockReset().mockResolvedValue({ generation: 8 })
  host.enterpriseUpdateAccount.mockReset().mockResolvedValue(undefined)
})

test.each([
  ["macos", "ai.alwith.u"],
  ["macos", "ai.alwith.u.dev"],
  ["windows", "ai.alwith.u"],
  ["linux", "ai.alwith.u"]
])(
  "registration sends the %s native application identity %s and retains the existing device id",
  async (channel, bundleId) => {
    host.platform.mockReturnValue(channel)
    host.identifier.mockResolvedValue(bundleId)
    const { authClient } = await import("../store")
    expect(host.identifier).not.toHaveBeenCalled()
    await authClient.register("a@example.test", "123456", "password")
    expect(host.request).toHaveBeenCalledWith(
      "/api/v1/auth/register",
      "POST",
      {
        email: "a@example.test",
        code: "123456",
        password: "password",
        channel,
        bundle_id: bundleId,
        client_type: "DESKTOP",
        client_name: `Tauri-${channel}-aarch64`,
        device_id: "existing-device"
      },
      false
    )
  }
)

test("registration rejects unsupported native platforms without sending a request", async () => {
  host.platform.mockReturnValue("freebsd")
  const { authClient } = await import("../store")
  await expect(authClient.register("a@example.test", "123456", "password")).rejects.toThrow(
    "Unsupported desktop registration platform: freebsd"
  )
  expect(host.request).not.toHaveBeenCalled()
  expect(host.identifier).not.toHaveBeenCalled()
})

test("registration does not send a request when native identity fails and can retry", async () => {
  const { authClient } = await import("../store")
  host.identifier.mockRejectedValueOnce(new Error("native identity unavailable"))
  await expect(authClient.register("a@example.test", "123456", "password")).rejects.toThrow(
    "native identity unavailable"
  )
  expect(host.request).not.toHaveBeenCalled()
  await authClient.register("a@example.test", "123456", "password")
  expect(host.identifier).toHaveBeenCalledTimes(2)
  expect(host.request).toHaveBeenCalledOnce()
})

async function restore() {
  const auth = await import("../store")
  await auth.initPlatformAuth()
  await vi.waitFor(() => expect(auth.usePlatformAuth.getState().isLoading).toBe(false))
  expect(auth.usePlatformAuth.getState().user?.user_uuid).toBe(cached.user_uuid)
  return { ...auth, ...(await import("../alwith-models")), ...(await import("../enterprise-models")) }
}

test("model refresh retries profile validation after cached login survives a startup failure", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  const auth = await restore()
  expect(host.bind).not.toHaveBeenCalled()
  await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
  expect(host.request).toHaveBeenCalledTimes(2)
  expect(host.bind).toHaveBeenCalledWith({
    apiBaseUrl: "https://api.example.test/service",
    userUuid: cached.user_uuid
  })
  expect(host.refresh).toHaveBeenCalledWith(1, "test-access")
  expect(host.enterpriseBind).not.toHaveBeenCalled()
  expect(host.enterpriseRefresh).not.toHaveBeenCalled()
})

test("ALwith retry succeeds without touching an expired enterprise authorization", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  host.enterpriseBind.mockRejectedValueOnce(new Error("enterprise unavailable"))
  host.enterpriseRefresh.mockRejectedValueOnce(new Error("enterprise_authorization_required"))
  const auth = await restore()
  await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
  expect(host.refresh).toHaveBeenCalledWith(1, "test-access")
  expect(host.enterpriseBind).not.toHaveBeenCalled()
  expect(host.enterpriseRefresh).not.toHaveBeenCalled()
})

test("startup enterprise failure does not affect later ALwith refreshes", async () => {
  host.enterpriseRefresh.mockRejectedValue(new Error("enterprise_authorization_required"))
  const auth = await restore()
  await vi.waitFor(() => expect(host.errors).toHaveBeenCalledWith("enterprise.error"))
  const enterpriseCalls = host.enterpriseRefresh.mock.calls.length
  await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
  expect(host.refresh).toHaveBeenCalledTimes(2)
  expect(host.enterpriseRefresh).toHaveBeenCalledTimes(enterpriseCalls)
})

test("startup ALwith failure does not prevent enterprise refresh", async () => {
  host.refresh.mockRejectedValueOnce(new Error("ALwith catalog unavailable"))
  await restore()
  await vi.waitFor(() => expect(host.errors).toHaveBeenCalledWith("ALwith catalog unavailable"))
  expect(host.enterpriseRefresh).toHaveBeenCalledWith({
    account: { apiBaseUrl: "https://api.example.test/service", userUuid: cached.user_uuid },
    generation: 8,
    accessToken: "test-access"
  })
})

test("enterprise refresh does not depend on or refresh ALwith models", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  host.bind.mockRejectedValue(new Error("ALwith unavailable"))
  const auth = await restore()
  await expect(auth.requestEnterpriseProviderRefresh()).resolves.toBeUndefined()
  expect(host.bind).not.toHaveBeenCalled()
  expect(host.refresh).not.toHaveBeenCalled()
  expect(host.enterpriseRefresh).toHaveBeenCalledWith({
    account: { apiBaseUrl: "https://api.example.test/service", userUuid: cached.user_uuid },
    generation: 8,
    accessToken: "test-access"
  })
})

test("ALwith refresh errors reach the caller and retry fetches again", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  host.refresh.mockRejectedValueOnce(new Error("ALwith catalog unavailable"))
  const auth = await restore()
  await expect(auth.requestAccountProviderRefresh()).rejects.toThrow("ALwith catalog unavailable")
  await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
  expect(host.refresh).toHaveBeenCalledTimes(2)
  expect(host.enterpriseBind).not.toHaveBeenCalled()
})

test("logout clears both providers even when one cleanup fails", async () => {
  const auth = await restore()
  await vi.waitFor(() => expect(host.enterpriseRefresh).toHaveBeenCalledOnce())
  host.clear.mockRejectedValueOnce(new Error("cleanup unavailable"))
  await auth.logoutPlatform()
  expect(host.clear).toHaveBeenCalledOnce()
  expect(host.enterpriseClear).toHaveBeenCalledOnce()
  expect(host.errors).toHaveBeenCalledWith("ALwith model cleanup failed: Error: cleanup unavailable")
  expect(auth.usePlatformAuth.getState().user).toBeNull()
  await expect(auth.requestAccountProviderRefresh()).rejects.toThrow("Sign in")
  await expect(auth.requestEnterpriseProviderRefresh()).rejects.toThrow("Sign in")
})

test("ALwith refresh completes while an enterprise request is still pending", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  let finish!: () => void
  host.enterpriseRefresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const auth = await restore()
  const enterprise = auth.requestEnterpriseProviderRefresh()
  await vi.waitFor(() => expect(host.enterpriseRefresh).toHaveBeenCalledOnce())
  try {
    await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
    expect(host.refresh).toHaveBeenCalledOnce()
  } finally {
    finish()
    await enterprise
  }
})

test("logout rejects a late ALwith refresh result and keeps enterprise access cleared", async () => {
  host.request.mockRejectedValueOnce(new Error("startup offline"))
  let finish!: () => void
  host.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const auth = await restore()
  const refresh = auth.requestAccountProviderRefresh()
  await vi.waitFor(() => expect(host.refresh).toHaveBeenCalledOnce())
  await auth.logoutPlatform()
  finish()
  await expect(refresh).rejects.toThrow("account changed")
  expect(host.enterpriseClear).toHaveBeenCalledOnce()
  expect(host.enterpriseRefresh).not.toHaveBeenCalled()
  expect(auth.usePlatformAuth.getState().user).toBeNull()
})

test("a failed validation reports its actual error and a later refresh retries it", async () => {
  host.request
    .mockRejectedValueOnce(new Error("startup offline"))
    .mockRejectedValueOnce(new Error("profile unavailable"))
  const auth = await restore()
  await expect(auth.requestAccountProviderRefresh()).rejects.toThrow("profile unavailable")
  expect(host.bind).not.toHaveBeenCalled()
  await expect(auth.requestAccountProviderRefresh()).resolves.toBeUndefined()
  expect(host.request).toHaveBeenCalledTimes(3)
  expect(host.refresh).toHaveBeenCalledOnce()
})

test("a successfully restored profile does not need another validation before model refresh", async () => {
  const auth = await restore()
  await vi.waitFor(() => expect(host.refresh).toHaveBeenCalledOnce())
  await auth.requestAccountProviderRefresh()
  expect(host.request).toHaveBeenCalledTimes(1)
  expect(host.refresh).toHaveBeenCalledTimes(2)
})

test("validation cannot bind a profile belonging to a different cached account", async () => {
  host.request
    .mockRejectedValueOnce(new Error("startup offline"))
    .mockResolvedValueOnce({ ...profile, uuid: "other-account" })
  const auth = await restore()
  await expect(auth.requestAccountProviderRefresh()).rejects.toThrow("account changed")
  expect(host.bind).not.toHaveBeenCalled()
  expect(auth.usePlatformAuth.getState().user?.user_uuid).toBe(cached.user_uuid)
  await auth.requestAccountProviderRefresh()
  expect(host.bind).toHaveBeenCalledOnce()
})

test("enterprise renewal events validate the account before updating native credentials", async () => {
  await restore()
  await vi.waitFor(() => expect(host.enterpriseRefresh).toHaveBeenCalledOnce())
  host.request.mockClear()
  const validation = Promise.withResolvers<typeof profile>()
  host.request.mockReturnValueOnce(validation.promise)
  const payload = {
    type: "enterpriseAccountRefreshRequested",
    accountId: cached.user_uuid,
    generation: 8,
    requestId: "renewal-1"
  }
  for (const listener of host.listeners.get("enterprise:event") ?? [])
    listener({ event: "enterprise:event", id: 0, payload })
  await vi.waitFor(() => expect(host.request).toHaveBeenCalledWith("/api/v1/me/profile", "GET"))
  expect(host.enterpriseUpdateAccount).not.toHaveBeenCalled()
  validation.resolve(profile)
  await vi.waitFor(() =>
    expect(host.enterpriseUpdateAccount).toHaveBeenCalledWith({
      generation: 8,
      requestId: "renewal-1",
      accessToken: "test-access"
    })
  )
  expect(host.refresh).toHaveBeenCalledOnce()
})

test("enterprise events cannot renew credentials from a stale generation", async () => {
  await restore()
  await vi.waitFor(() => expect(host.enterpriseRefresh).toHaveBeenCalledOnce())
  const payload = {
    type: "enterpriseAccountRefreshRequested",
    accountId: cached.user_uuid,
    generation: 7,
    requestId: "old-renewal"
  }
  for (const listener of host.listeners.get("enterprise:event") ?? [])
    listener({ event: "enterprise:event", id: 0, payload })
  await vi.waitFor(() => expect(host.enterpriseStatus).toHaveBeenCalledOnce())
  expect(host.enterpriseUpdateAccount).not.toHaveBeenCalled()
})
