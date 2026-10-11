// The app-wide CodexClient instance and the React bindings to its store.

import { driveSessionContext } from "@/features/drive/session-context"
import type { Session } from "@alwith/api"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useStore } from "zustand"
import type { AppState } from "@/agent/client"
import { DesktopCodexClient } from "@/lib/desktop-client"
import { RemoteChatClient } from "@/lib/chat-window-client"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"
import { macProjectPaths } from "@/agent/project-path"
import { isMac } from "@/lib/platform"

export const client =
  isTauri() && getCurrentWebviewWindow().label === "chat"
    ? new RemoteChatClient()
    : new DesktopCodexClient(runtimeClient, {
        agentId: CODEX_AGENT_ID,
        launch: { engine: "codex" },
        projectPaths: isMac() ? macProjectPaths : undefined,
        sessionContext: driveSessionContext
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

/** `done` clears only through the Runtime: a session someone looked at is read everywhere. */
export async function markRead(sessionId: string): Promise<void> {
  const port = await runtimeClient()
  await port.markRead(sessionId)
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
