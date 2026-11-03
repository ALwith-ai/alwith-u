import type { SessionSummary } from "@alwith/module-chat/client"

/** Codex persists this source with dedicated image conversations. */
export const IMAGE_THREAD_SOURCE = "alwith-images"

export function isImageSession(session: Pick<SessionSummary, "threadSource">): boolean {
  return session.threadSource === IMAGE_THREAD_SOURCE
}
