import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"

import type { SettingsAccount, SettingsAgent } from "../../src/lib/settings-bridge"
import { client } from "./client"

export type { SettingsAccount, SettingsAgent } from "../../src/lib/settings-bridge"
export const accountPreview = createStore<{ account: SettingsAccount | undefined }>(() => ({ account: undefined }))
export type AccountCase =
  | "ready"
  | "loading"
  | "unavailable"
  | "apiKey"
  | "bedrock"
  | "noLimits"
  | "emptyLimits"
  | "exhausted"
  | "signingIn"
  | "signingOut"
  | "error"
let mode: AccountCase = "ready"
export async function resetAccount(signedIn = true, kind: AccountCase = "ready"): Promise<void> {
  mode = kind
  if (kind === "loading" || kind === "unavailable") {
    accountPreview.setState({ account: kind === "loading" ? undefined : null })
    return
  }
  const limits = await client.readRateLimits()
  const identity = await client.readAccount()
  accountPreview.setState({
    account: {
      account: signedIn
        ? {
            ...identity,
            account:
              kind === "apiKey"
                ? { type: "apiKey" }
                : kind === "bedrock"
                  ? { type: "amazonBedrock", usesCodexManagedCredentials: true }
                  : identity.account
          }
        : { account: null, requiresOpenaiAuth: true },
      rateLimits:
        kind === "noLimits"
          ? null
          : kind === "emptyLimits"
            ? { ...limits, primary: null, secondary: null }
            : kind === "exhausted"
              ? {
                  ...limits,
                  primary: limits.primary && { ...limits.primary, usedPercent: 100 },
                  secondary: limits.secondary && { ...limits.secondary, usedPercent: 100 },
                  spendControlReached: true
                }
              : limits
    }
  })
}
export function useSettingsAccount() {
  return useStore(accountPreview, (state) => state.account)
}
export function useSettingsAgent(): SettingsAgent {
  return { name: "Codex", version: "0.164.0", authMethods: client.state.agent?.authMethods ?? [], actions: [] }
}
export async function requestSignIn(): Promise<void> {
  if (mode === "signingIn") return new Promise(() => {})
  if (mode === "error") throw new Error("模拟身份验证失败，请重试。")
  await resetAccount(true)
}
export async function requestSignOut(): Promise<void> {
  if (mode === "signingOut") return new Promise(() => {})
  if (mode === "error") throw new Error("模拟退出失败，请重试。")
  await resetAccount(false)
}
export async function requestActionResponse(): Promise<void> {}
export function serveSettingsBridge(): () => void {
  return () => {}
}
