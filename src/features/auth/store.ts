import {
  assertActiveLogin,
  type AuthActions,
  type AuthState,
  type AuthStateEvent,
  authStoreName,
  createAuthClient,
  createAuthState,
  createTokenStorage,
  type LoginResponse,
  type RegistrationContext
} from "@alwith/module-auth"
import { createTauriAuthRefresh } from "@alwith/module-auth/tauri"
import { createAuthTransport } from "@alwith/module-auth/transport"
import { createManagedProvidersPort } from "@alwith/module-chat/settings"
import { emit, emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { fetch } from "@tauri-apps/plugin-http"
import { arch, platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"
import { create } from "zustand"

import { appEnv } from "@/lib/app-env"
import i18n from "@/lib/i18n"
import { openStore } from "@/lib/store"

import { logEnterpriseError, logEnterpriseResponse, traceEnterprise } from "./enterprise-diagnostics"
import { createEnterpriseModels, enterpriseModelLabels } from "./enterprise-models"
import { createAccountTransition, createManagedProviders } from "./managed-providers"
import { createProviderRefreshClient, serveProviderRefresh } from "./provider-refresh-bridge"
import { registrationContext } from "./registration-context"

export const API_BASE_URL = appEnv.apiBaseUrl
const STATE_EVENT = "alwith-auth-state"
const LOGOUT_EVENT = "alwith-auth-logout-request"
const isMain = () => getCurrentWebviewWindow().label === "main"
// Reuse the existing login store; each write persists atomically.
const store = openStore(authStoreName(API_BASE_URL))
const storage = createTokenStorage({
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  delete: (key) => store.delete(key)
})
const expiredListeners = new Set<() => void>()
const stateListeners = new Set<(event: AuthStateEvent) => void>()
const refreshTokens = createTauriAuthRefresh()
const transport = createAuthTransport({
  baseUrl: API_BASE_URL,
  fetch: async (input, init) => {
    const started = performance.now()
    const path = new URL(String(input)).pathname
    try {
      const response = await fetch(input, init)
      if (!response.ok) await logEnterpriseResponse(`${init?.method ?? "GET"} ${path}`, response)
      return response
    } catch (reason) {
      logEnterpriseError(`http ${path} elapsed_ms=${Math.round(performance.now() - started)}`, reason)
      throw reason
    }
  },
  storage,
  refresh: (refreshToken) => refreshTokens(API_BASE_URL, refreshToken),
  expired: async () => {
    if (!isMain()) {
      await emitTo("main", LOGOUT_EVENT)
      return
    }
    await clearAccountProviders()
    for (const listener of expiredListeners) listener()
    await storage.clearAllAuth()
    await emit(STATE_EVENT, { action: "logout" } satisfies AuthStateEvent)
  }
})
const accountProviders = createManagedProvidersPort()
async function validateAccount(userUuid: string): Promise<void> {
  const profile = await transport.request<{ uuid: string }>("/api/v1/me/profile", "GET")
  if (profile?.uuid !== userUuid || usePlatformAuth.getState().user?.user_uuid !== userUuid)
    throw new Error("ALwith account changed during profile validation")
}
const managedProviders = createManagedProviders({
  validate: validateAccount,
  bind: (userUuid) => accountProviders.bind({ apiBaseUrl: API_BASE_URL, userUuid }),
  refresh: (generation) =>
    transport.authenticated(async (accessToken) => {
      await accountProviders.refresh(generation, accessToken)
    }),
  clear: () => accountProviders.clear()
})
const enterpriseProviders = createEnterpriseModels({
  environment: appEnv.environment,
  account: () => usePlatformAuth.getState().user?.user_uuid ?? null,
  email: () => usePlatformAuth.getState().user?.login_email ?? null,
  labels: async () => {
    // A metadata outage must not prevent gateway login or renewal.
    const value = await transport.request("/api/v1/providers/finture-enterprise", "GET").catch(() => null)
    return value === null ? null : enterpriseModelLabels(value)
  }
})
async function clearAccountProviders(): Promise<void> {
  const results = await Promise.allSettled([managedProviders.clear(), enterpriseProviders.clear()])
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logEnterpriseError(`clear-${index === 0 ? "account" : "enterprise"}-providers`, result.reason)
      toast.error(`${index === 0 ? "ALwith" : "Enterprise"} model cleanup failed: ${String(result.reason)}`)
    }
  }
}
async function loadAccountProviders(): Promise<void> {
  if (!isMain()) throw new Error("ALwith model refresh belongs to the main window")
  const user = usePlatformAuth.getState().user
  if (!user) throw new Error("Sign in to refresh ALwith models")
  await traceEnterprise("refresh-providers", () => managedProviders.refresh(user.user_uuid))
}
async function loadEnterpriseProviders(): Promise<void> {
  if (!isMain()) throw new Error("Enterprise model refresh belongs to the main window")
  const user = usePlatformAuth.getState().user
  if (!user) throw new Error("Sign in to refresh enterprise models")
  await traceEnterprise("refresh-enterprise-providers", () => enterpriseProviders.refresh())
}
function refreshSignedInProviders(): void {
  if (!isMain()) return
  void loadAccountProviders().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : String(error)
    toast.error(message)
  })
  void loadEnterpriseProviders().catch(() => toast.error(i18n.t("enterprise.error")))
}
let requestProviderRefresh: (() => Promise<void>) | undefined
export function requestAccountProviderRefresh(): Promise<void> {
  requestProviderRefresh ??= createProviderRefreshClient(getCurrentWebviewWindow().label)
  return requestProviderRefresh()
}
let requestEnterpriseRefresh: (() => Promise<void>) | undefined
export function requestEnterpriseProviderRefresh(): Promise<void> {
  requestEnterpriseRefresh ??= createProviderRefreshClient(getCurrentWebviewWindow().label, undefined, "enterprise")
  return requestEnterpriseRefresh()
}
export const platformApiRequest = transport.request
async function getRegistrationContext(): Promise<RegistrationContext> {
  return registrationContext(await storage.tokenStorage.getDeviceId())
}
export const authClient = createAuthClient({
  publicPost: (path, body) => transport.request(path, "POST", body, false),
  apiPost: (path, body) => transport.request(path, "POST", body),
  platform,
  arch,
  getDeviceId: storage.tokenStorage.getDeviceId,
  getRegistrationContext,
  onLogoutError: () => console.warn("[auth] remote logout failed; clearing local login"),
  logInfo: () => {}
})
export const usePlatformAuth = create<AuthState & AuthActions>(
  createAuthState({
    storage,
    getProfile: () => transport.request("/api/v1/me/profile", "GET"),
    logoutApi: authClient.logoutApi,
    onInit: () => {},
    validateProfile: isMain,
    handleUnauthenticated: async () => {
      if (!isMain()) await getCurrentWebviewWindow().hide()
      return false
    },
    // Account providers are coordinated by the main window; Codex history and login remain engine-owned.
    loadProviders: () => {},
    clearProviders: () => {},
    onProfileRestored: () => {
      const user = usePlatformAuth.getState().user
      if (!user) throw new Error("ALwith profile restored without an account")
      managedProviders.confirm(user.user_uuid)
      enterpriseProviders.confirm(user.user_uuid)
      refreshSignedInProviders()
    },
    clearAccountConversation: async () => {},
    onSignedIn: (user, source) => {
      if (source === "login") {
        managedProviders.confirm(user.user_uuid)
        enterpriseProviders.confirm(user.user_uuid)
        refreshSignedInProviders()
      }
    },
    subscribeExpired: (listener) => expiredListeners.add(listener),
    subscribeState: (listener) => stateListeners.add(listener),
    broadcast: (event) => emit(STATE_EVENT, event)
  })
)

const transitionAccount = createAccountTransition()
export function logoutPlatform(): Promise<void> {
  if (!isMain()) return emitTo("main", LOGOUT_EVENT)
  return transitionAccount(async () => {
    await clearAccountProviders()
    await transport.invalidate()
    await usePlatformAuth.getState().logout()
  })
}

export function loginPlatform(response: LoginResponse): Promise<void> {
  if (!isMain()) return Promise.reject(new Error("ALwith login belongs to the main window"))
  assertActiveLogin(response)
  return transitionAccount(async () => {
    await clearAccountProviders()
    await transport.invalidate()
    await usePlatformAuth.getState().login(response)
  })
}

/** Register listeners before restoring credentials; called once by each window bootstrap. */
export async function initPlatformAuth(): Promise<void> {
  await listen<AuthStateEvent>(STATE_EVENT, (event) => {
    for (const listener of stateListeners) listener(event.payload)
  })
  if (isMain()) await serveProviderRefresh(loadAccountProviders)
  if (isMain()) await enterpriseProviders.init()
  if (isMain())
    await listen(LOGOUT_EVENT, () => {
      void logoutPlatform().catch(() => console.error("[auth] local logout failed"))
    })
  usePlatformAuth.getState().init()
}
