import { useCallback, useEffect, useMemo, useState } from "react"

export interface VoiceResume {
  receipt: string
  consume(): void
}

/** Only the surface that accepted the first voice message may resume its next recording. */
export function useVoiceHandoff(
  sessionId: string | null,
  generation: number
): {
  accept(target: string, receipt: string): void
  resume: VoiceResume | undefined
} {
  const [pending, setPending] = useState<{ sessionId: string; receipt: string; generation: number } | null>(null)
  const accept = useCallback(
    (target: string, receipt: string): void => {
      setPending({ sessionId: target, receipt, generation })
    },
    [generation]
  )
  const consume = useCallback((): void => setPending(null), [])
  useEffect(() => {
    if (pending !== null && (pending.sessionId !== sessionId || pending.generation !== generation)) setPending(null)
  }, [pending, sessionId, generation])
  const resume = useMemo<VoiceResume | undefined>(
    () =>
      pending !== null && pending.sessionId === sessionId && pending.generation === generation
        ? { receipt: pending.receipt, consume }
        : undefined,
    [pending, sessionId, generation, consume]
  )
  return { accept, resume }
}
