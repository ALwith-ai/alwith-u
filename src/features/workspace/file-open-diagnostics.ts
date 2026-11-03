import { info } from "@tauri-apps/plugin-log"

import { drive } from "@/features/drive/controller"
import { logBackgroundError } from "@/lib/background-errors"

let sequence = 0

/** Record the stage before awaiting it so a stalled open still leaves evidence. */
export async function traceFileOpen<T>(
  path: string,
  source: string,
  operation: (stage: (name: string) => void) => Promise<T>
): Promise<T> {
  const id = ++sequence
  const started = performance.now()
  let currentStage = "started"
  const context = () => {
    const state = drive.getSnapshot()
    const snapshot = state.snapshot
    return JSON.stringify({
      id,
      source,
      path,
      stage: currentStage,
      elapsedMs: Math.round(performance.now() - started),
      drive: {
        connected: state.connected,
        configured: snapshot?.configured,
        running: snapshot?.running,
        generation: snapshot?.generation,
        roots: snapshot?.roots?.length,
        files: snapshot?.files?.length,
        error: state.error ?? snapshot?.error
      }
    })
  }
  const stage = (name: string) => {
    currentStage = name
    void info(`[workspace-file-open] ${context()}`).catch((error) => console.error("[error-log]", error))
  }
  stage("started")
  try {
    const result = await operation(stage)
    stage("completed")
    return result
  } catch (error) {
    logBackgroundError(`workspace-file-open ${context()}`, error)
    throw error
  }
}
