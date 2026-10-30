import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { commands } from "@/bindings"
import { displayedActivityIds } from "@/features/sessions/activity-display-order"
import { useActivityOrder } from "@/features/sessions/activity-order"
import { reportBackgroundError } from "@/lib/background-errors"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"
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
    void (async () => {
      let messageId: string | null = null
      let failure: string | null = null
      try {
        messageId = await sendMobilePrompt(client, payload)
      } catch (error: unknown) {
        failure = error instanceof Error ? error.message : String(error)
        reportBackgroundError("mobile-prompt", error)
      }
      if (payload.deviceId && payload.clientRequestId) {
        await commands.bridgePromptResult({
          deviceId: payload.deviceId,
          sessionId: payload.sessionId,
          clientRequestId: payload.clientRequestId,
          status: messageId ? "accepted" : "unknown",
          messageId,
          error: failure
        })
      }
    })().catch((error: unknown) => reportBackgroundError("mobile-receipt", error))
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
  let previous: string[] | null = null
  let sync: Promise<unknown> = Promise.resolve()
  const publishOrder = (): void => {
    const sessionIds = displayedActivityIds(
      useActivityOrder.getState().ids,
      useMainWindowSurface.getState(),
      useChatWindowSurface.getState()
    )
    const last = previous
    if (last && sessionIds.length === last.length && sessionIds.every((id, i) => id === last[i])) return
    previous = sessionIds
    sync = sync
      .catch((error: unknown) => reportBackgroundError("mobile-activity", error))
      .then(() => commands.mobileSetActivitySessions({ sessionIds }))
    void sync.catch((error: unknown) => reportBackgroundError("mobile-activity", error))
  }
  useActivityOrder.subscribe(publishOrder)
  useMainWindowSurface.subscribe(publishOrder)
  useChatWindowSurface.subscribe(publishOrder)
  publishOrder()
  await sync
  if (mobileEnabled()) await commands.mobileBridgeStart({ relayUrl: MOBILE_RELAY_URL })
}
