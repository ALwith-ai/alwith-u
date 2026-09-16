/**
 * Context ring in the input footer, ALwith Desktop's ContextRing + TokenUsageDetails reduced
 * for Codex: the ring shows how much of the model's window the last turn used (muted below
 * 70%, foreground from 70%, destructive from 90%); hovering opens the token details of the
 * last turn and the context window summary. Cost rows are dropped: Codex sends no cost.
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { hasAccount, type RateLimitSnapshot } from "@/agent/codex-extensions"
import { limitWindowLabel } from "@/features/settings/sections/codex-provider-section"
import { client, useApp } from "@/lib/client"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { isSelectOption, type SelectOption } from "@alwith/api"
import type { Session } from "@alwith/api"
import { cn } from "@/lib/utils"
import { flattenSelectOptions } from "./composer/permission-mode-select"

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 })
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

function norm(value: number | null | undefined): number {
  return typeof value === "number" && !Number.isNaN(value) ? Math.max(0, value) : 0
}

/** Ring colour steps from Desktop's `contextRingStats`; the percentage is capped at 100. */
export function contextRingStats(used: number, size: number): { pct: number; className: string } {
  const pct = Math.min(100, (used / size) * 100)
  const className = pct >= 90 ? "text-destructive" : pct >= 70 ? "text-foreground" : "text-muted-foreground"
  return { pct, className }
}

function currentModel(session: Session): string | undefined {
  const option = session.configOptions.find(item => item.category === "model" && isSelectOption(item)) as
    SelectOption | undefined
  if (option === undefined) return undefined
  return flattenSelectOptions(option).find(item => item.value === option.currentValue)?.name ?? option.currentValue
}

/** The plan's rate limits, read once and then followed through `_codex/rate_limits_updated`. */
function useRateLimits(): RateLimitSnapshot | null {
  const available = useApp(state => state.connection === "ready" && hasAccount(state.agent))
  const [limits, setLimits] = useState<RateLimitSnapshot | null>(null)
  useEffect(() => {
    if (!available) {
      setLimits(null)
      return
    }
    let alive = true
    client.readRateLimits().then(
      snapshot => {
        if (alive) setLimits(snapshot)
      },
      () => undefined
    )
    const stop = client.onRateLimits(snapshot => {
      if (alive) setLimits(snapshot)
    })
    return () => {
      alive = false
      stop()
    }
  }, [available])
  return limits
}

export function UsageMeter({ session }: { session: Session }) {
  const { t } = useTranslation()
  const limits = useRateLimits()
  const usage = session.usage
  const turn = session.lastTurnUsage
  if (usage === null && turn === null) return null
  const ring = usage && usage.size > 0 ? contextRingStats(usage.used, usage.size) : null
  const radius = 7
  const circumference = 2 * Math.PI * radius

  const input = norm(turn?.inputTokens)
  const output = norm(turn?.outputTokens)
  const cachedRead = norm(turn?.cachedReadTokens)
  const cachedWrite = norm(turn?.cachedWriteTokens)
  // The agent's total is the truth; summing again would be a second source that drifts.
  const total = norm(turn?.totalTokens) || input + output + cachedRead + cachedWrite
  const promptTokens = input + cachedRead
  const hitRate = promptTokens > 0 ? percentFormat.format(cachedRead / promptTokens) : t("chat.tokens.notAvailable")
  const rows: Array<[string, string]> = [
    [t("chat.tokens.input"), integer.format(input)],
    [t("chat.tokens.output"), integer.format(output)],
    [t("chat.tokens.cachedRead"), integer.format(cachedRead)],
    [t("chat.tokens.cachedWrite"), integer.format(cachedWrite)],
    [t("chat.tokens.cacheHitRate"), hitRate],
    [t("chat.tokens.total"), integer.format(total)]
  ]
  const model = currentModel(session)

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        closeDelay={100}
        render={
          <button
            type="button"
            className={cn(
              "hover:text-foreground flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs tabular-nums",
              ring?.className ?? "text-muted-foreground"
            )}
            aria-label={t("chat.tokens.openDetails")}>
            <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
              <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
              {ring !== null && (
                <circle
                  cx="9"
                  cy="9"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - ring.pct / 100)}
                  transform="rotate(-90 9 9)"
                />
              )}
            </svg>
            {ring !== null && <span>{Math.round(ring.pct)}%</span>}
          </button>
        }
      />
      <HoverCardContent align="end" side="top" sideOffset={8} className="w-56 p-0">
        {model !== undefined && (
          <div className="border-b px-3 py-2">
            <p className="text-foreground truncate text-xs font-semibold" title={model}>
              {model}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">{t("chat.tokens.openDetails")}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
              {rows.map(([label, value]) => (
                <div className="contents" key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-end tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {usage !== null && usage.size > 0 && (
            <div className="flex flex-col gap-1.5 border-t pt-2">
              <p className="text-xs font-medium">{t("chat.tokens.context")}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {t("chat.tokens.contextSummary", {
                  used: integer.format(usage.used),
                  limit: integer.format(usage.size),
                  percent: oneDecimal.format((usage.used / usage.size) * 100)
                })}
              </p>
            </div>
          )}
          {limits !== null && (limits.primary !== null || limits.secondary !== null) && (
            <div className="flex flex-col gap-1.5 border-t pt-2">
              <p className="text-xs font-medium">{t("usage.limits")}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                {[limits.primary, limits.secondary]
                  .filter((window): window is NonNullable<typeof window> => window !== null)
                  .map(window => (
                    <div className="contents" key={`${window.windowDurationMins ?? "window"}`}>
                      <dt className="text-muted-foreground">{limitWindowLabel(window, t)}</dt>
                      <dd className="text-end tabular-nums">
                        {t("usage.used", { percent: Math.round(Math.min(100, Math.max(0, window.usedPercent))) })}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
