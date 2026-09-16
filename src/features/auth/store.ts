import {
  authStoreName,
  createAuthClient,
  createAuthState,
  createTokenStorage,
  type AuthActions,
  type AuthState,
  type AuthStateEvent,
  type LoginResponse
} from "@alwith/auth"
import { invoke } from "@tauri-apps/api/core"
import { emit, emitTo, listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { fetch } from "@tauri-apps/plugin-http"
import { arch, platform } from "@tauri-apps/plugin-os"
import { LazyStore } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { createAuthTransport } from "./http"
import { assertActiveLogin } from "./login-response"

export const API_BASE_URL = import.meta.env.DEV ? "https://api-dev.alwith.ai/service" : "https://api.alwith.ai/service"
const STATE_EVENT = "alwith-auth-state"
const LOGOUT_EVENT = "alwith-auth-logout-request"
const isMain = () => getCurrentWebviewWindow().label === "main"
const store = new LazyStore(`${authStoreName(API_BASE_URL)}.json`)
const storage = createTokenStorage({
  get: key => store.get(key),
  set: async (key, value) => {
    await store.set(key, value)
    await store.save()
  },
  delete: async key => {
    await store.delete(key)
    await store.save()
  }
})
const expiredListeners = new Set<() => void>()
const stateListeners = new Set<(event: AuthStateEvent) => void>()
const transport = createAuthTransport({
  baseUrl: API_BASE_URL,
  fetch,
  storage,
  refresh: refreshToken => invoke("refresh_tokens", { apiBaseUrl: API_BASE_URL, refreshToken }),
  expired: async () => {
    for (const listener of expiredListeners) listener()
    await storage.clearAllAuth()
    await emit(STATE_EVENT, { action: "logout" } satisfies AuthStateEvent)
  }
})
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
    // ALwith login never alters Codex history, provider credentials or CLI login.
    loadProviders: () => {},
    clearProviders: () => {},
    onProfileRestored: () => {},
    clearAccountConversation: async () => {},
    onSignedIn: () => {},
    subscribeExpired: listener => expiredListeners.add(listener),
    subscribeState: listener => stateListeners.add(listener),
    broadcast: event => emit(STATE_EVENT, event)
  })
)

let logoutPending: Promise<void> | undefined
export async function logoutPlatform(): Promise<void> {
  if (!isMain()) return emitTo("main", LOGOUT_EVENT)
  if (logoutPending) return logoutPending
  const work = (async () => {
    await transport.invalidate()
    await usePlatformAuth.getState().logout()
  })()
  logoutPending = work
  try {
    await work
  } finally {
    logoutPending = undefined
  }
}

export async function loginPlatform(response: LoginResponse): Promise<void> {
  if (!isMain()) throw new Error("ALwith login belongs to the main window")
  assertActiveLogin(response)
  await logoutPending
  await transport.invalidate()
  await usePlatformAuth.getState().login(response)
}

/** Register listeners before restoring credentials; called once by each window bootstrap. */
export async function initPlatformAuth(): Promise<void> {
  await listen<AuthStateEvent>(STATE_EVENT, event => {
    for (const listener of stateListeners) listener(event.payload)
  })
  if (isMain())
    await listen(LOGOUT_EVENT, () => {
      void logoutPlatform().catch(() => console.error("[auth] local logout failed"))
    })
  usePlatformAuth.getState().init()
}
