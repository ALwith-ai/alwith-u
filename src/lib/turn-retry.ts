import { SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { codexRetryNotice, codexTurnId, nativeTurnId, type Session } from "@alwith/module-chat/client"
import type { Turn } from "@alwith/module-chat/session-timeline"

type RetryNotice = { turnId: string; message: string; capacity: boolean }
type ProjectedSession = Session & { retryingTurn?: RetryNotice }

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function retryError(meta: Session["_meta"] | undefined): RetryNotice | undefined {
  const error = record(record(meta?.codex)?.error)
  if (error?.willRetry !== true || typeof error.turnId !== "string" || typeof error.message !== "string") return
  const info = error.codexErrorInfo
  return {
    turnId: error.turnId,
    message: error.message,
    capacity:
      info === "serverOverloaded" ||
      info === "policyCapacityUnavailable" ||
      record(record(info)?.responseStreamDisconnected)?.httpStatusCode === 429
  }
}

/** Fold only accepted live ACP frames. Session-info snapshots may repeat an earlier warning. */
export function projectTurnRetry(
  previous: Session,
  session: ProjectedSession,
  update: SessionUpdate
): ProjectedSession {
  const pending = session.retryingTurn
  if (session.attached && !session.restoring && session.state === "running") {
    if (SessionUpdate.isSessionInfoUpdate(update)) {
      if (update._meta === undefined) return session
      const next = retryError(session._meta)
      const prior = retryError(previous._meta)
      if (next && next.turnId === prior?.turnId && next.message === prior.message && next.capacity === prior.capacity)
        return session
      if (next) {
        const lastUser = session.items.findLast((item) => item.kind === "user" && nativeTurnId(item) !== null)
        if (lastUser && nativeTurnId(lastUser) !== next.turnId) return session
        return { ...session, retryingTurn: next }
      }
    } else {
      if (!pending || session.items === previous.items) return session
      const owner = codexTurnId(record(update._meta))
      if (owner !== null && owner !== pending.turnId) return session
    }
  }
  if (!pending) return session
  const { retryingTurn: _retired, ...rest } = session
  return rest
}

export function turnRetryNotice(session: ProjectedSession, turn: Turn) {
  const pending = session.retryingTurn
  if (pending) return turn.items.some((item) => nativeTurnId(item) === pending.turnId) ? pending : null
  return codexRetryNotice(session._meta)
}
