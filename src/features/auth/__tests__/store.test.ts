import type { EventCallback } from "@tauri-apps/api/event"
import { beforeEach, expect, test, vi } from "vitest"

const host = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  listeners: new Map<string, Set<EventCallback<unknown>>>(),
  request: vi.fn(),
  bind: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
  errors: vi.fn(),
  enterpriseBind: vi.fn(),
  enterpriseRefresh: vi.fn(),
  enterpriseClear: vi.fn()
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
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))
vi.mock("@tauri-apps/plugin-os", () => ({ arch: () => "aarch64", platform: () => "macos" }))
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
    enterpriseClear: host.enterpriseClear
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
  host.request.mockReset().mockResolvedValue(profile)
  host.bind.mockResolvedValue(1)
  host.refresh.mockResolvedValue(undefined)
  host.clear.mockResolvedValue(undefined)
  host.enterpriseBind.mockResolvedValue(8)
  host.enterpriseRefresh.mockResolvedValue(null)
  host.enterpriseClear.mockResolvedValue(undefined)
})

async function restore() {
  const auth = await import("../store")
  await auth.initPlatformAuth()
  await vi.waitFor(() => expect(auth.usePlatformAuth.getState().isLoading).toBe(false))
  expect(auth.usePlatformAuth.getState().user?.user_uuid).toBe(cached.user_uuid)
  return auth
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
  expect(host.enterpriseRefresh).toHaveBeenCalledWith({
    account: { apiBaseUrl: "https://api.example.test/service", userUuid: cached.user_uuid },
    generation: 8,
    accessToken: "test-access"
  })
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
