import { observeRunStates } from "@alwith/api"
import type { Session } from "@nyssance/codex-acp-v2/client";
// The app-wide CodexClient instance and the React bindings to its store.
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useStore } from "zustand"

import type { AppState } from "@/agent/client"
import { macProjectPaths } from "@/agent/project-path"
import { commands, events } from "@/bindings"
import { computerRuntimeEnv } from "@/features/computer/runtime-config"
import { computerContextRevision, hostSessionContext, prepareComputerTools } from "@/features/computer/session-context"
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
        projectPaths: isMac() ? macProjectPaths : undefined,
        resolveModel: async (model) => {
          const providers = await applyProvidersWhenIdle()
          // Create a reusable draft on the currently applied catalog. Prompt admission retries
          // the saved provider revision after active turns have finished.
          return providers.status === "pending" && !isAccountModel(model) ? null : resolveSessionModel(model, providers)
        },
        sessionContext: hostSessionContext,
        sessionContextRevision: computerContextRevision,
        prepareSessionTools: prepareComputerTools,
        revokeSessionAccess: async (sessionId) => {
          await commands.computerStopSession({ sessionId })
        }
      })

/** Mirrors the Runtime's run states into the client store for the lifetime of the app. */
export async function watchRunStates(): Promise<() => void> {
  const stopRevoked = await events["providers:managed-revoked"].listen((event) =>
    client.markAccountModelsUnavailable(event.payload.sessionIds)
  )
  try {
  const port = await runtimeClient()
  const watcher = observeRunStates(port, (sessions, source) =>
    client.applyRunStates(sessions, source === "snapshot" ? "snapshot" : undefined)
  )
  await watcher.ready
  return () => { watcher.dispose(); stopRevoked() }
  } catch (error) {
    stopRevoked()
    throw error
  }
}

/** `done` clears only through the Runtime: a session someone looked at is read everywhere. The
 *  confirmation names the version on screen: a session that finished again since keeps its new `done`. */
export async function markRead(sessionId: string): Promise<void> {
  const port = await runtimeClient()
  await port.markRead(sessionId, client.state.runStates[sessionId]?.version ?? null)
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
