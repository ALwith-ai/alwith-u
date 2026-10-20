/** Validate optional adapter metadata at the rendering boundary. */
export function questionReply(meta: unknown): { question: string; answer: string } | null {
  if (!meta || typeof meta !== "object" || !("codex" in meta)) return null
  const codex = meta.codex
  if (!codex || typeof codex !== "object" || !("questionReply" in codex)) return null
  const reply = codex.questionReply
  if (!reply || typeof reply !== "object" || !("question" in reply) || !("answer" in reply)) return null
  return typeof reply.question === "string" && typeof reply.answer === "string"
    ? { question: reply.question, answer: reply.answer }
    : null
}

/** Receipt adoption preserves local content; the adapter also supplies its display parts. */
export function questionReplyParts(meta: unknown): Array<{ text: string; question?: string }> | null {
  if (!meta || typeof meta !== "object" || !("codex" in meta)) return null
  const codex = meta.codex
  if (!codex || typeof codex !== "object" || !("questionReplyParts" in codex)) return null
  const parts = codex.questionReplyParts
  if (!Array.isArray(parts) || parts.length === 0) return null
  if (
    !parts.every(
      (part) =>
        part &&
        typeof part === "object" &&
        typeof part.text === "string" &&
        (part.question === undefined || typeof part.question === "string")
    )
  )
    return null
  return parts.map((part) => ({ text: part.text, ...(part.question === undefined ? {} : { question: part.question }) }))
}
