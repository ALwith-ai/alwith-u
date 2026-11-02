import { error, info, warn } from "@tauri-apps/plugin-log"

function record(write: (message: string) => Promise<void>, message: string): void {
  void write(message).catch((failure: unknown) => console.error("[startup log]", failure))
}

/** Observe startup without racing or cancelling work that may still complete. */
export async function startupStep<T>(name: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  record(info, `[startup] ${name}: started`)
  const pending = setTimeout(() => record(warn, `[startup] ${name}: still pending after 15000ms`), 15_000)
  try {
    const result = await work()
    record(info, `[startup] ${name}: completed in ${Math.round(performance.now() - started)}ms`)
    return result
  } catch (failure) {
    record(error, `[startup] ${name}: failed: ${failure instanceof Error ? failure.message : String(failure)}`)
    throw failure
  } finally {
    clearTimeout(pending)
  }
}

/** Startup precedes the toast host; fatal errors must replace the cold-start placeholder. */
export function showStartupFailure(failure: unknown): void {
  const root = document.getElementById("root")
  if (root)
    root.textContent = `ALwith U startup failed: ${failure instanceof Error ? failure.message : String(failure)}`
  document.documentElement.style.visibility = "visible"
}
