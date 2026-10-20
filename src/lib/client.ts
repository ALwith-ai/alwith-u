import { commands } from "@/bindings"
// The app-wide CodexClient instance and the React bindings to its store.

import type { Session } from "@alwith/api"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useStore } from "zustand"
import type { AppState } from "@/agent/client"
import { macProjectPaths } from "@/agent/project-path"
import { hostSessionContext, computerContextRevision, prepareComputerTools } from "@/features/computer/session-context"
import { computerRuntimeEnv } from "@/features/computer/runtime-config"
import { RemoteChatClient } from "@/lib/chat-window-client"
import { DesktopCodexClient } from "@/lib/desktop-client"
import { isMac } from "@/lib/platform"
import { applyProvidersWhenIdle, resolveSessionModel } from "@/lib/providers"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"

export const client =
  isTauri() && getCurrentWebviewWindow().label === "chat"
    ? new RemoteChatClient()
    : new DesktopCodexClient(runtimeClient, {
        agentId: CODEX_AGENT_ID,
        launch: { engine: "codex", env: computerRuntimeEnv },
        projectPaths: isMac() ? macProjectPaths : undefined,
        resolveModel: async model => {
          const providers = await applyProvidersWhenIdle()
          // Create a reusable draft on the currently applied catalog. Prompt admission retries
          // the saved provider revision after active turns have finished.
          return providers.status === "pending" ? null : resolveSessionModel(model, providers)
        },
        sessionContext: hostSessionContext,
        sessionContextRevision: computerContextRevision,
        prepareSessionTools: prepareComputerTools,
        revokeSessionAccess: async sessionId => {
          await commands.computerStopSession({ sessionId })
        }
      })

/** Mirrors the Runtime's run states into the client store for the lifetime of the app. */
export async function watchRunStates(): Promise<() => void> {
  const port = await runtimeClient()
  let revision = 0
  const stop = await port.onRunStates(sessions => {
    revision++
    client.applyRunStates(sessions)
  })
  const baseline = revision
  const snapshot = await port.runStates()
  if (revision === baseline) client.applyRunStates(snapshot, "snapshot")
  return stop
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
  return useStore(client.store, state => (id === null ? null : (state.sessions[id] ?? null)))
}
