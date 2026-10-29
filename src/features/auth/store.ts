import {
  type AuthActions,
  type AuthState,
  type AuthStateEvent,
  authStoreName,
  createAuthClient,
  createAuthState,
  createTokenStorage,
  type LoginResponse
} from "@alwith/module-auth"
import { createTauriAuthRefresh } from "@alwith/module-auth/tauri"
import { invoke } from "@tauri-apps/api/core"
import { emit, emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { fetch } from "@tauri-apps/plugin-http"
import { arch, platform } from "@tauri-apps/plugin-os"
import { toast } from "sonner"
import { create } from "zustand"

import { commands } from "@/bindings"
import { appEnv } from "@/lib/app-env"
import { openStore } from "@/lib/store"

import { createAuthTransport } from "@alwith/module-auth/transport"
import { assertActiveLogin } from "@alwith/module-auth"
import { createAccountTransition, createManagedProviders } from "./managed-providers"

export const API_BASE_URL = appEnv.apiBaseUrl
const STATE_EVENT = "alwith-auth-state"
const LOGOUT_EVENT = "alwith-auth-logout-request"
const PROVIDERS_REFRESH_EVENT = "alwith-providers-refresh-request"
const isMain = () => getCurrentWebviewWindow().label === "main"
// 同一个 `appDataDir/<name>.json`,原 tauri-plugin-store 写下的登录态原样读回;每次 set 即原子落盘。
const store = openStore(authStoreName(API_BASE_URL))
const storage = createTokenStorage({
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  delete: (key) => store.delete(key)
})
const expiredListeners = new Set<() => void>()
const stateListeners = new Set<(event: AuthStateEvent) => void>()
const refreshTokens = createTauriAuthRefresh(invoke)
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
const managedProviders = createManagedProviders({
  bind: (userUuid) => commands.providersAccountBind({ account: { apiBaseUrl: API_BASE_URL, userUuid } }),
  refresh: async (generation) => {
    await transport.authenticated((accessToken) => commands.providersRefreshManaged({ generation, accessToken }))
  },
  clear: async () => {
    await commands.providersClearManaged()
  }
})
let validatedAccount: string | null = null
async function clearAccountProviders(): Promise<void> {
  validatedAccount = null
  try {
    await managedProviders.clear()
  } catch (error) {
    toast.error(`ALwith model cleanup failed: ${String(error)}`)
  }
}
function refreshAccountProviders(): void {
  if (!isMain()) return
  const user = usePlatformAuth.getState().user
  if (!user || user.user_uuid !== validatedAccount) return
  void managedProviders.refresh(user.user_uuid).catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : String(error)
    toast.error(message)
  })
}
export function requestAccountProviderRefresh(): Promise<void> {
  return emitTo("main", PROVIDERS_REFRESH_EVENT)
}
export const platformApiRequest = transport.request
export const authClient = createAuthClient({
  publicPost: (path, body) => transport.request(path, "POST", body, false),
  apiPost: (path, body) => transport.request(path, "POST", body),
  platform,
  arch,
  getDeviceId: storage.tokenStorage.getDeviceId,
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
      validatedAccount = usePlatformAuth.getState().user?.user_uuid ?? null
      refreshAccountProviders()
    },
    clearAccountConversation: async () => {},
    onSignedIn: (user, source) => {
      if (source === "login") {
        validatedAccount = user.user_uuid
        refreshAccountProviders()
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
  if (isMain()) await listen(PROVIDERS_REFRESH_EVENT, refreshAccountProviders)
  if (isMain())
    await listen(LOGOUT_EVENT, () => {
      void logoutPlatform().catch(() => console.error("[auth] local logout failed"))
    })
  usePlatformAuth.getState().init()
}
