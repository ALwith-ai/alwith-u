import { observeRunStates } from "@alwith/api"
import type { Session } from "@alwith/module-chat/client"
import { createManagedProvidersPort } from "@alwith/module-chat/settings"
// The app-wide CodexClient instance and the React bindings to its store.
import { commands as computer } from "@alwith/module-computer/commands"
import { commands as device } from "@alwith/module-device/commands"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useStore } from "zustand"

import type { AppState } from "@/agent/client"
import { macProjectPaths } from "@/agent/project-path"
import { configureSessionInputConfig, readSessionInputMode } from "@/features/chat/composer/input-mode-config"
import { computerRuntimeEnv } from "@/features/computer/runtime-config"
import { hostSessionContext } from "@/features/computer/session-context"
import { useImagePreferences } from "@/features/images/preferences"
import { RemoteChatClient } from "@/lib/chat-window-client"
import { DesktopCodexClient } from "@/lib/desktop-client"
import { isMac } from "@/lib/platform"
import { applyProvidersWhenIdle, isAccountModel, resolveSessionModel } from "@/lib/providers"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"

export const client =
  isTauri() && getCurrentWebviewWindow().label === "chat"
    ? new RemoteChatClient()
    : new DesktopCodexClient(runtimeClient, {
        agentId: CODEX_AGENT_ID,
        launch: { engine: "codex", env: computerRuntimeEnv },
        imageService: {
          inputMode: readSessionInputMode,
          selection: () => useImagePreferences.getState().selection,
          generateExternal: async (selection, prompt, images, signal) => {
            const requestId = crypto.randomUUID()
            const cancel = () => {
              void invoke("images_cancel", { requestId }).catch(() => undefined)
            }
            signal?.throwIfAborted()
            signal?.addEventListener("abort", cancel, { once: true })
            try {
              return await invoke("images_generate", { input: { ...selection, prompt, images, requestId } })
            } finally {
              signal?.removeEventListener("abort", cancel)
            }
          }
        },
        projectPaths: isMac() ? macProjectPaths : undefined,
        resolveModel: async (model, purpose) => {
          const providers = await applyProvidersWhenIdle()
          // Create a reusable draft on the currently applied catalog. Prompt admission retries
          // the saved provider revision after active turns have finished.
          return providers.status === "pending" && !isAccountModel(model)
            ? null
            : resolveSessionModel(model, providers, purpose)
        },
        sessionContext: hostSessionContext,
        revokeSessionAccess: async (sessionId) => {
          void computer.stopSession({ sessionId }).catch((error: unknown) => {
            console.error("Cannot release computer access", error)
          })
          await device.stopSession({ sessionId }).catch(() => undefined)
        }
      })

configureSessionInputConfig({
  read: (id) => client.readInputConfig(id),
  write: (id, preferences) => client.writeInputConfig(id, preferences)
})

/** Mirrors the Runtime's run states into the client store for the lifetime of the app. */
export async function watchRunStates(): Promise<() => void> {
  const stopRevoked = await createManagedProvidersPort().onRevoked((sessionIds) =>
    client.markAccountModelsUnavailable(sessionIds)
  )
  try {
    const port = await runtimeClient()
    const watcher = observeRunStates(port, (sessions, source) =>
      client.applyRunStates(sessions, source === "snapshot" ? "snapshot" : undefined)
    )
    await watcher.ready
    return () => {
      watcher.dispose()
      stopRevoked()
    }
  } catch (error) {
    stopRevoked()
    throw error
  }
}

/** `done` clears only through the Runtime: a session someone looked at is read everywhere. The
 *  confirmation names the version on screen: a session that finished again since keeps its new `done`. */
export async function markRead(sessionId: string): Promise<void> {
  const version = client.state.runStates[sessionId]?.version ?? null
  const port = await runtimeClient()
  await port.markRead(sessionId, version)
}

/** Close only this session; Runtime.stopSession would kill the shared Codex agent. */
export async function stopSession(sessionId: string): Promise<void> {
  await client.stopSession(sessionId)
}

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(client.store, selector)
}

export function useSession(id: string | null): Session | null {
  return useStore(client.store, (state) => (id === null ? null : (state.sessions[id] ?? null)))
}
