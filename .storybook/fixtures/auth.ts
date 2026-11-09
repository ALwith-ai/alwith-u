import type { AuthActions, AuthState, LoginResponse } from "@alwith/module-auth"
import { create } from "zustand"

export const API_BASE_URL = "https://api.example.test/service"
export const demoUser = { user_uuid: "storybook-user", nickname: "林然", login_email: "lin.ran@finture.id" }
export type AuthCase =
  | "ready"
  | "loading"
  | "sending"
  | "signingIn"
  | "registering"
  | "registered"
  | "network"
  | "wrongCode"
  | "wrongPassword"
  | "checkingEmail"
  | "emailCheckNetwork"
  | "emptyFailure"
  | "sessionFailure"
let mode: AuthCase = "ready"
let failure: string | null = null
export function configureAuthScenario(kind: AuthCase = "ready", error: string | null = null): void {
  mode = kind
  failure = error
}
export const usePlatformAuth = create<AuthState & AuthActions>((set) => ({
  user: demoUser,
  isAuthenticated: true,
  isLoading: false,
  _initialized: true,
  init: () => {},
  login: (user) => {
    set({ user, isAuthenticated: true })
    return Promise.resolve()
  },
  logout: () => {
    set({ user: null, isAuthenticated: false })
    return Promise.resolve()
  },
  refreshUser: async () => {},
  updateUser: (partial) => set((state) => ({ user: state.user ? { ...state.user, ...partial } : null }))
}))
export function resetAuth(authenticated = true, error: string | null = null, kind: AuthCase = "ready"): void {
  mode = kind
  failure = error
  usePlatformAuth.setState({
    user: authenticated ? demoUser : null,
    isAuthenticated: authenticated,
    isLoading: kind === "loading"
  })
}
async function loginResponse(): Promise<LoginResponse> {
  if (mode === "signingIn" || mode === "registering") return new Promise(() => {})
  if (failure) throw new Error(failure)
  if (mode === "wrongCode") throw new Error("验证码错误或已过期，请重新获取。")
  if (mode === "wrongPassword") throw new Error("邮箱或密码错误，请重试。")
  if (mode === "network") throw new Error("网络连接失败，请稍后重试。")
  if (mode === "emptyFailure") throw new Error("")
  return { ...demoUser, access_token: "storybook", refresh_token: "storybook", status: "ACTIVE" }
}
export const authClient = {
  emailExists: async () => {
    if (mode === "checkingEmail") return new Promise<{ registered: boolean }>(() => {})
    if (mode === "emailCheckNetwork") throw new Error("网络连接失败，请稍后重试。")
    return { registered: mode === "registered" }
  },
  sendVerificationCode: async () => {
    if (mode === "sending") return new Promise<void>(() => {})
    if (mode === "network") throw new Error("网络连接失败，请稍后重试。")
    if (failure) throw new Error(failure)
  },
  register: loginResponse,
  loginWithPassword: loginResponse,
  loginWithCode: loginResponse
}
export const loginPlatform = async (response: LoginResponse) => {
  if (mode === "sessionFailure") throw new Error("保存登录状态失败，请重试。")
  await usePlatformAuth.getState().login(response)
}
export const logoutPlatform = async () => usePlatformAuth.getState().logout()
export const initPlatformAuth = async () => {}
export function platformApiRequest<T>(): Promise<T> {
  return Promise.reject(new Error("Live platform requests are disabled in Storybook"))
}

export async function requestAccountProviderRefresh(): Promise<void> {}
