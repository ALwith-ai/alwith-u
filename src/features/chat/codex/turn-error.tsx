import type { TurnError } from "@alwith/api"
import { AlertCircleIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { codexTurnError } from "@/agent/codex-extensions"
import { Button } from "@/components/ui/button"

export type TurnRetry = {
  turnId: string
  delaySeconds: number | null
  run: (trigger: "manual" | "automatic") => Promise<void>
}

export function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <div className="codex-error-message" role="alert">
      <AlertCircleIcon aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function TurnErrorView({ error, retry }: { error: TurnError; retry?: TurnRetry }) {
  const { t } = useTranslation()
  const detail = codexTurnError(error)
  const [deadline] = useState(() => (retry?.delaySeconds == null ? null : Date.now() + retry.delaySeconds * 1000))
  const [seconds, setSeconds] = useState(retry?.delaySeconds ?? null)
  const [busy, setBusy] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const claimed = useRef(false)
  const automaticStopped = useRef(false)
  const run = useRef(retry?.run)
  run.current = retry?.run
  const attempt = useRef((trigger: "manual" | "automatic") => {
    const submit = run.current
    if (claimed.current || submit === undefined) return
    claimed.current = true
    setBusy(true)
    setRetryError(null)
    void submit(trigger).catch((failure: unknown) => {
      automaticStopped.current = true
      claimed.current = false
      setSeconds(null)
      setBusy(false)
      setRetryError(failure instanceof Error ? failure.message : String(failure))
    })
  })
  const enabled = retry !== undefined && detail.retryable
  useEffect(() => {
    if (!enabled || deadline === null) return
    const tick = () => {
      if (automaticStopped.current || claimed.current) return
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSeconds(remaining)
      if (remaining === 0) attempt.current("automatic")
    }
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadline, enabled])
  return (
    <ErrorCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 whitespace-pre-wrap">{detail.message}</div>
        {enabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => attempt.current("manual")}>
            {seconds === null ? t("chat.error.retry") : t("chat.error.retryCountdown", { seconds })}
          </Button>
        )}
      </div>
      {retryError !== null && <div className="mt-2 text-sm text-muted-foreground">{retryError}</div>}
    </ErrorCard>
  )
}
