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
