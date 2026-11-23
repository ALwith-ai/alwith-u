import { ConfigStaleError } from "@alwith/module-chat/client"
import { commands as mobile } from "@alwith/module-mobile/commands"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { commands } from "@/bindings"
import { displayedActivityIds } from "@/features/sessions/activity-display-order"
import { useActivityOrder } from "@/features/sessions/activity-order"
import { reportBackgroundError } from "@/lib/background-errors"
import { useChatWindowSurface, useMainWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"
import { settingsStore, updateSettings } from "@/lib/settings-store"
import { text } from "@/lib/text"

import { type MobilePermission, type MobilePrompt, respondMobilePermission, sendMobilePrompt } from "./actions"
import { MobileQuestions, QuestionUnavailable } from "./questions"
import { initializeSessionActions } from "./session-actions"

export const MOBILE_RELAY_URL = "wss://relay.alwith.ai/v1/ws"
export function mobileEnabled(): boolean {
  return settingsStore.get<boolean>("mobile.bridgeEnabled") ?? false
}
export async function setMobileEnabled(enabled: boolean): Promise<void> {
  if (enabled) await mobile.mobileBridgeStart({ relayUrl: MOBILE_RELAY_URL })
  else await mobile.mobileBridgeStop()
  await updateSettings({ "mobile.bridgeEnabled": enabled })
}

/** Main is the sole Codex owner, including sessions shown in the floating chat window. */
export async function initializeMobile(): Promise<void> {
  if (!isTauri()) return
  const questions = new MobileQuestions()
  let previous: string | null = null
  let sync: Promise<unknown> = Promise.resolve()
  const publishOrder = (): Promise<unknown> => {
    const sessionIds = displayedActivityIds(
      useActivityOrder.getState().ids,
      useMainWindowSurface.getState(),
      useChatWindowSurface.getState()
    )
    const questionTokens = questions.project(client.state, sessionIds)
    const signature = JSON.stringify([sessionIds, questionTokens])
    if (signature === previous) return sync
    previous = signature
    sync = sync.catch(() => undefined).then(() => commands.mobileSetActivitySessions({ sessionIds, questionTokens }))
    const publication = sync
    void publication.catch((error: unknown) => {
      if (sync === publication) previous = null
      reportBackgroundError("mobile-activity", error)
    })
    return publication
  }
  const repairReceipts = (): void => {
    void questions
      .repairReceipts((confirmation) =>
        mobile.bridgePromptResult({
          ...confirmation,
          status: "accepted",
          error: null
        })
      )
      .catch((error: unknown) => reportBackgroundError("mobile-receipt", error))
  }
  await listen<MobilePrompt>("bridge:send-prompt", ({ payload }) => {
    void (async () => {
      let messageId: string | null = null
      let failure: string | null = null
      let rejected = false
      try {
        if (payload.clientRequestId?.startsWith("question/")) {
          if (payload.files?.length) throw new QuestionUnavailable("Unexpected question attachment")
          messageId = await questions.submit(
            client,
            payload.sessionId,
            payload.text,
            payload.deviceId,
            payload.clientRequestId
          )
        } else messageId = await sendMobilePrompt(client, payload)
      } catch (error: unknown) {
        const refused = payload.clientRequestId?.startsWith("question/") && error instanceof ConfigStaleError
        rejected = error instanceof QuestionUnavailable || Boolean(refused)
        if (refused)
          await publishOrder()
            .catch(() => publishOrder())
            .catch((syncError: unknown) => reportBackgroundError("mobile-question-sync", syncError))
        failure = text(error)
        reportBackgroundError("mobile-prompt", error)
      }
      if (payload.deviceId && payload.clientRequestId) {
        try {
          await mobile.bridgePromptResult({
            deviceId: payload.deviceId,
            sessionId: payload.sessionId,
            clientRequestId: payload.clientRequestId,
            status: messageId ? "accepted" : rejected ? "rejected" : "unknown",
            messageId,
            error: failure
          })
        } finally {
          if (payload.clientRequestId.startsWith("question/") && !messageId && !rejected) {
            questions.receiptUnknown(payload.sessionId, payload.clientRequestId)
            void publishOrder()
            repairReceipts()
          }
        }
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
  await initializeSessionActions(client)
  client.store.subscribe((state, prior) => {
    if (state.sessions !== prior.sessions || state.connection !== prior.connection) {
      void publishOrder()
      repairReceipts()
    }
  })
  const onActivityChange = (): void => {
    void publishOrder()
  }
  useActivityOrder.subscribe(onActivityChange)
  useMainWindowSurface.subscribe(onActivityChange)
  useChatWindowSurface.subscribe(onActivityChange)
  await publishOrder()
  if (mobileEnabled()) await mobile.mobileBridgeStart({ relayUrl: MOBILE_RELAY_URL })
}
