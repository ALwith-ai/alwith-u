// The Runtime connection for this app: Rust spawns alwith-runtime over stdio; the webview
// talks frames through Tauri events and commands (`@alwith/api/tauri`).

import { TauriRuntimeClient } from "@alwith/api/tauri"
import { events, type RuntimeExit } from "@/bindings"

/** Emitted by Rust when the alwith-runtime process ends. */
export type { RuntimeExit } from "@/bindings"

/** What the Runtime's launcher accepts for `start` (see alwith-runtime `apps/runtime`). */
export type CodexProvider = {
  engine: "codex"
  cwd?: string
  env?: Record<string, string>
  provider?: string
  model?: string
}

export const CODEX_AGENT_ID = "codex"

let port: TauriRuntimeClient<CodexProvider> | null = null

/**
 * The port to the running Runtime. Rust starts the process on first use; after an exit the
 * next call hands out a fresh port, which makes Rust spawn a fresh Runtime.
 */
export function runtimeClient(): Promise<TauriRuntimeClient<CodexProvider>> {
  port ??= new TauriRuntimeClient<CodexProvider>()
  return Promise.resolve(port)
}

/** Forgets the current port and closes it; the next `runtimeClient()` starts over. */
export function resetHubPort(): void {
  const stale = port
  port = null
  stale?.close()
}

/** alwith-runtime ended (crash or kill): the port is dead and every subscription with it. */
export function onHubExit(handler: (exit: RuntimeExit) => void): Promise<() => void> {
  return events["runtime:exit"].listen(event => {
    port?.markExited()
    resetHubPort()
    handler(event.payload)
  })
}
