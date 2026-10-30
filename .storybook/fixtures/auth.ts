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
let mode: AuthCase = "ready"
let failure: string | null = null
export const usePlatformAuth = create<AuthState & AuthActions>((set) => ({
  user: demoUser,
  isAuthenticated: true,
  isLoading: false,
  _initialized: true,
  init: () => {},
  login: async (user) => {
    set({ user, isAuthenticated: true })
  },
  logout: async () => {
    set({ user: null, isAuthenticated: false })
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
  return { ...demoUser, access_token: "storybook", refresh_token: "storybook", status: "ACTIVE" }
}
export const authClient = {
  emailExists: async () => ({ registered: mode === "registered" }),
  sendVerificationCode: async () => {
    if (mode === "sending") return new Promise<void>(() => {})
    if (mode === "network") throw new Error("网络连接失败，请稍后重试。")
    if (failure) throw new Error(failure)
  },
  register: loginResponse,
  loginWithPassword: loginResponse,
  loginWithCode: loginResponse
}
export const loginPlatform = async (response: LoginResponse) => usePlatformAuth.getState().login(response)
export const logoutPlatform = async () => usePlatformAuth.getState().logout()
export const initPlatformAuth = async () => {}
export async function platformApiRequest<T>(): Promise<T> {
  throw new Error("Live platform requests are disabled in Storybook")
}
