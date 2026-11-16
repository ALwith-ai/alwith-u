import { logBackgroundError } from "./background-errors"

/** Present the account gateway by its product name while retaining persisted routing IDs. */
export function presentProviderError(message: string): string {
  return message.replace(
    /\bProvider (?:[^;\r\n]*? \(litellm\)|litellm)(?= (?:could not|settings are not applied|was removed)\b)/g,
    "Provider ALwith"
  )
}

/** Project native error envelopes without copying credentials or request payloads into diagnostics. */
export function describeProviderError(error: unknown): string {
  const seen = new Set<object>()
  const describe = (value: unknown): string => {
    if (typeof value === "string") return value
    if (value === null || typeof value !== "object") return String(value)
    if (seen.has(value)) return "[circular error]"
    seen.add(value)
    const fields = value as Record<string, unknown>
    const details = [
      "message",
      "detail",
      "reason",
      "error",
      "cause",
      "data",
      "code",
      "kind",
      "type",
      "stage",
      "status",
      "httpStatus",
      "requestId",
      "transportCode"
    ].flatMap((key) =>
      fields[key] === undefined ? [] : [key === "message" ? describe(fields[key]) : `${key}: ${describe(fields[key])}`]
    )
    return details.length ? details.join("; ") : "Unknown provider error"
  }
  return presentProviderError(describe(error))
    .replaceAll(/(\b(?:https?|wss?|socks5h?):\/\/)[^\s/?#]*@/gi, "$1[redacted]@")
    .replaceAll(
      /(\b(?:authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|client[_-]?secret|token|secret)\b["']*\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+[^\s,;}\]]+|[^\s,;}\]]+)/gi,
      "$1[redacted]"
    )
    .replaceAll(/\bsk-[\w-]+/gi, "[redacted]")
    .replaceAll(/\b(Bearer|Basic)\s+[^\s";,]+/gi, "$1 [redacted]")
    .replaceAll(/([?&](?:api[_-]?key|token|access_token)=)[^&\s]+/gi, "$1[redacted]")
}

export function logProviderError(operation: string, error: unknown): void {
  logBackgroundError(`providers/${operation}`, describeProviderError(error))
}
