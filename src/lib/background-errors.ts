import { error as logError } from "@tauri-apps/plugin-log"
import { toast } from "sonner"

/** Preserve nested causes in the log; native errors may also arrive as plain objects. */
export function errorDetails(error: unknown): string {
  const seen = new Set<unknown>()
  const describe = (value: unknown): string => {
    if (value instanceof Error) {
      if (seen.has(value)) return "[circular error cause]"
      seen.add(value)
      const detail = value.stack ?? value.message
      return value.cause === undefined ? detail : `${detail}\nCaused by: ${describe(value.cause)}`
    }
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  return describe(error)
}

export function logBackgroundError(context: string, error: unknown): void {
  void logError(`[${context}] ${errorDetails(error)}`).catch(failure => console.error("[error-log]", failure))
}

/** A stable notice per operation prevents concurrent startup failures from flooding the screen. */
export function reportBackgroundError(
  context: string,
  error: unknown,
  options: { message?: string; action?: { label: string; onClick: () => void } } = {}
): void {
  logBackgroundError(context, error)
  toast.error(options.message ?? (error instanceof Error ? error.message : errorDetails(error)), {
    id: context,
    action: options.action
  })
}
