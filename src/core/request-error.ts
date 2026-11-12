/** ACP shares the server-error range with Runtime failures; the code alone is not enough. */
export function isAuthenticationRequired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const value = error as { code?: unknown; reason?: unknown; message?: unknown }
  const reason = value.reason ?? value.message
  return value.code === -32000 && typeof reason === "string" && /^Authentication required(?:$|:)/.test(reason)
}

/** Preserve the transport error identity while exposing the agent's actionable details. */
export function explainRequestError(error: unknown, method: string): unknown {
  if (!(error instanceof Error)) return error
  const data = (error as Error & { data?: unknown }).data
  const details =
    typeof data === "string"
      ? data
      : typeof data === "object" && data !== null
        ? (data as { details?: unknown }).details
        : undefined
  if (typeof details !== "string" || details.trim() === "") return error
  error.message = `${method}: ${details}`
  return error
}
