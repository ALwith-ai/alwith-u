import { info } from "@tauri-apps/plugin-log"

import { logBackgroundError } from "@/lib/background-errors"
import { describeProviderError } from "@/lib/provider-errors"

/** Never log browser proofs, callback URLs, account tokens or request payloads. */
export function logEnterpriseError(stage: string, reason: unknown): void {
  const detail = describeProviderError(reason)
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"']+/gi, (value) => {
      try {
        return `${new URL(value).origin}/[redacted]`
      } catch {
        return "[redacted-url]"
      }
    })
    .replace(/\b(state|ticket|otp|proof)(["']*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, "$1$2[redacted]")
  logBackgroundError(`enterprise/${stage}`, detail)
}

export async function traceEnterprise<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const operation = crypto.randomUUID()
  const started = performance.now()
  void info(`[enterprise] operation=${operation} stage=${stage} started`).catch(console.error)
  try {
    const result = await work()
    void info(
      `[enterprise] operation=${operation} stage=${stage} elapsed_ms=${Math.round(performance.now() - started)} completed`
    ).catch(console.error)
    return result
  } catch (reason) {
    logEnterpriseError(`${stage} operation=${operation} elapsed_ms=${Math.round(performance.now() - started)}`, reason)
    throw reason
  }
}

/** Inspect a bounded clone, leaving authentication retries and the caller's response intact. */
export async function logEnterpriseResponse(stage: string, response: Response): Promise<void> {
  const reader = response.clone().body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let cause: unknown
  let data: unknown
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 16 * 1024) {
          cause = "Response exceeds diagnostic limit"
          break
        }
        chunks.push(value)
      }
      if (!cause) {
        const body = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.byteLength
        }
        try {
          data = JSON.parse(new TextDecoder().decode(body))
        } catch {
          cause = "Non-JSON error response"
        }
      }
    } catch (reason) {
      cause = reason
    } finally {
      void reader.cancel().catch(console.error)
    }
  }
  logEnterpriseError(stage, {
    message: "ALwith HTTP request rejected",
    status: response.status,
    requestId:
      response.headers.get("x-request-id") ??
      response.headers.get("x-correlation-id") ??
      response.headers.get("traceparent"),
    data,
    cause
  })
}
