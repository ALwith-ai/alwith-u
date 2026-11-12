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
import { getIdentifier } from "@tauri-apps/api/app"
import { emit, emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { fetch } from "@tauri-apps/plugin-http"
import { arch, platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"
import { create } from "zustand"

import { appEnv } from "@/lib/app-env"
import { openStore } from "@/lib/store"

import { createAlwithModels } from "./alwith-models"
import { createEnterpriseModels } from "./enterprise-models"
import { createAccountTransition } from "./managed-providers"

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
  fetch,
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
async function validateAccount(userUuid: string): Promise<void> {
  const profile = await transport.request<{ uuid: string }>("/api/v1/me/profile", "GET")
  if (profile?.uuid !== userUuid || usePlatformAuth.getState().user?.user_uuid !== userUuid)
    throw new Error("ALwith account changed during profile validation")
}
const modelHost = {
  apiBaseUrl: API_BASE_URL,
  account: () => usePlatformAuth.getState().user?.user_uuid ?? null,
  validate: validateAccount,
  authenticated: (action: (accessToken: string) => Promise<void>) => transport.authenticated(action)
}
const alwithModels = createAlwithModels(modelHost)
const enterpriseModels = createEnterpriseModels({
  ...modelHost,
  refreshProfile: () => transport.request("/api/v1/me/profile", "GET")
})
async function clearAccountProviders(): Promise<void> {
  const results = await Promise.allSettled([alwithModels.clear(), enterpriseModels.clear()])
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected")
      toast.error(`${index === 0 ? "ALwith" : "Enterprise"} model cleanup failed: ${String(result.reason)}`)
  }
}
function refreshSignedInProviders(): void {
  if (!isMain()) return
  alwithModels.refreshInBackground()
  enterpriseModels.refreshInBackground()
}
export const platformApiRequest = transport.request
async function getRegistrationContext(): Promise<RegistrationContext> {
  const channel = platform()
  if (channel !== "macos" && channel !== "windows" && channel !== "linux")
    throw new Error(`Unsupported desktop registration platform: ${channel}`)
  const [bundleId, deviceId] = await Promise.all([getIdentifier(), storage.tokenStorage.getDeviceId()])
  return {
    channel,
    bundle_id: bundleId,
    client_type: "DESKTOP",
    client_name: `Tauri-${channel}-${arch()}`,
    device_id: deviceId
  }
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
      alwithModels.confirm(user.user_uuid)
      enterpriseModels.confirm(user.user_uuid)
      refreshSignedInProviders()
    },
    clearAccountConversation: async () => {},
    onSignedIn: (user, source) => {
      if (source === "login") {
        alwithModels.confirm(user.user_uuid)
        enterpriseModels.confirm(user.user_uuid)
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
  if (isMain()) {
    await alwithModels.init()
    await enterpriseModels.init()
  }
  if (isMain())
    await listen(LOGOUT_EVENT, () => {
      void logoutPlatform().catch(() => console.error("[auth] local logout failed"))
    })
  usePlatformAuth.getState().init()
}
