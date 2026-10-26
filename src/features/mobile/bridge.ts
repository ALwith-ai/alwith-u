import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { commands } from "@/bindings"
import { reportBackgroundError } from "@/lib/background-errors"
import { client } from "@/lib/client"
import { settingsStore, updateSettings } from "@/lib/settings-store"

import { type MobilePermission, type MobilePrompt, respondMobilePermission, sendMobilePrompt } from "./actions"

export const MOBILE_RELAY_URL = "wss://relay.alwith.ai/v1/ws"
export function mobileEnabled(): boolean {
  return settingsStore.get<boolean>("mobile.bridgeEnabled") ?? false
}
export async function setMobileEnabled(enabled: boolean): Promise<void> {
  if (enabled) await commands.mobileBridgeStart({ relayUrl: MOBILE_RELAY_URL })
  else await commands.mobileBridgeStop()
  await updateSettings({ "mobile.bridgeEnabled": enabled })
}

/** Main is the sole Codex owner, including sessions shown in the floating chat window. */
export async function initializeMobile(): Promise<void> {
  if (!isTauri()) return
  await listen<MobilePrompt>("bridge:send-prompt", ({ payload }) => {
    void sendMobilePrompt(client, payload).catch((error: unknown) => reportBackgroundError("mobile-prompt", error))
  })
  await listen<{ sessionId: string }>("bridge:cancel-session", ({ payload }) => {
    void client.cancel(payload.sessionId).catch((error: unknown) => reportBackgroundError("mobile-cancel", error))
  })
  await listen<MobilePermission>("bridge:permission-response", ({ payload }) =>
    respondMobilePermission(client, payload)
  )
  await listen<string>("bridge:error", ({ payload }) => {
    reportBackgroundError("mobile-bridge", new Error(payload))
  })
  if (mobileEnabled()) await commands.mobileBridgeStart({ relayUrl: MOBILE_RELAY_URL })
}
