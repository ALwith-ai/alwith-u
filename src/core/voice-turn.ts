import type { Session } from "@alwith/api"
/** Observes retained protocol facts for one receipt; never derives completion from busy transitions. */
export function observeVoiceTurn(
  source: { read(): Session | undefined; subscribe(check: () => void): () => void },
  signal: AbortSignal
): { completed: Promise<void>; accept(messageId: string): void } {
  let receipt: string | null = null
  let check!: () => void
  const completed = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stop()
      signal.removeEventListener("abort", abort)
    }
    const abort = (): void => {
      cleanup()
      reject(signal.reason)
    }
    check = (): void => {
      const session = source.read()
      if (session === undefined || !session.attached || session.state === "requires_action") {
        cleanup()
        reject(new Error("voice_turn_interrupted"))
        return
      }
      if (receipt === null) return
      if (session.items.findLast(item => item.kind === "user")?.id !== receipt) {
        cleanup()
        reject(new Error("voice_turn_superseded"))
        return
      }
      if (Object.hasOwn(session.turnEndedAt, receipt)) {
        cleanup()
        if (session.error === null && session.lastStopReason === "end_turn") resolve()
        else reject(new Error("voice_turn_not_completed"))
      }
    }
    const stop = source.subscribe(check)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    else check()
  })
  return {
    completed,
    accept(messageId): void {
      receipt = messageId
      check()
    }
  }
}
