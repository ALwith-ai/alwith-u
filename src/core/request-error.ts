/** ACP shares the server-error range with Runtime failures; the code alone is not enough. */
export function isAuthenticationRequired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const value = error as { code?: unknown; reason?: unknown; message?: unknown }
  const reason = value.reason ?? value.message
  return value.code === -32000 && typeof reason === "string" && /^Authentication required(?:$|:)/.test(reason)
}

/** Match the existing adapter contract narrowly; arbitrary invalid params are not recoverable model errors. */
export function isModelSelectionRequired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const value = error as { message?: unknown; reason?: unknown; data?: unknown }
  const details =
    typeof value.data === "object" && value.data !== null ? (value.data as { details?: unknown }).details : value.data
  return [value.message, value.reason, details].some(
    (message) =>
      typeof message === "string" &&
      [
        "The selected provider connection or model is unavailable",
        "The selected model connection is unavailable",
        "The selected ALwith account model is unavailable",
        "The ALwith account changed"
      ].some((reason) => message.includes(reason))
  )
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
