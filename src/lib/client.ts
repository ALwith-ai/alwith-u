// The app-wide CodexClient instance and the React bindings to its store.
import { useStore } from "zustand"
import { CodexClient, type AppState } from "@/agent/client"
import type { Session } from "@alwith/api"
import { CODEX_AGENT_ID, runtimeClient } from "@/lib/runtime"

export const client = new CodexClient(runtimeClient, { agentId: CODEX_AGENT_ID, launch: { engine: "codex" } })

/** Mirrors the Runtime's run states into the client store for the lifetime of the app. */
export async function watchRunStates(): Promise<() => void> {
  const port = await runtimeClient()
  const stop = await port.onRunStates(sessions => client.applyRunStates(sessions))
  client.applyRunStates(await port.runStates())
  return stop
}

/** `done` clears only through the Runtime: a session someone looked at is read everywhere. */
export async function markRead(sessionId: string): Promise<void> {
  const port = await runtimeClient()
  await port.markRead(sessionId)
}

/** Stop = the Runtime finds the agent behind the session and reaps its process. */
export async function stopSession(sessionId: string): Promise<void> {
  const port = await runtimeClient()
  await port.stopSession(sessionId)
}

export function useApp<T>(selector: (state: AppState) => T): T {
  return useStore(client.store, selector)
}

export function useSession(id: string | null): Session | null {
  return useStore(client.store, state => (id === null ? null : (state.sessions[id] ?? null)))
}
