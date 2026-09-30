// Account: who is signed in and how much of the plan's rate limits is used, ALwith
// Desktop's usage section reduced to what Codex reports (`account/read`,
// `account/rateLimits/read`). The settings window gets the data from the main window's
// agent connection through the settings bridge.
import { format } from "date-fns"
import type { TFunction } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { RateLimitWindow } from "@/agent/codex-extensions"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  requestSignIn,
  requestSignOut,
  requestActionResponse,
  useSettingsAccount,
  useSettingsAgent,
  type SettingsAccount
} from "@/lib/settings-bridge"
import { LoginCard } from "@/features/connection/login-card"
import { ActionCard } from "@/features/chat/action-card"
import { SettingGroup, SettingLabel } from "./shared"

/** Desktop's `UsageLimitRow`: label, a long bar, "n% used", then the reset time under it. */
export function UsageLimitRow({ label, window }: { label?: string; window?: RateLimitWindow }) {
  const { t } = useTranslation()
  const percent = window ? Math.round(Math.min(100, Math.max(0, window.usedPercent))) : 0
  const resets =
    window && window.resetsAt !== null
      ? t("usage.resetsAt", { time: format(new Date(window.resetsAt * 1000), "yyyy/MM/dd HH:mm") })
      : null
  return (
    <div className="space-y-1.5" aria-busy={!window}>
      <div className="grid min-h-5 grid-cols-[3.5rem_minmax(0,1fr)_5rem] items-center gap-3">
        {window ? (
          <span className="text-sm">{label}</span>
        ) : (
          <Skeleton className="h-4 w-10 motion-reduce:animate-none" />
        )}
        {window ? (
          <div
            className="bg-muted h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={label}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}>
            <div className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
          </div>
        ) : (
          <Skeleton className="h-2 rounded-full motion-reduce:animate-none" />
        )}
        {window ? (
          <span className="text-muted-foreground text-end text-xs tabular-nums">{t("usage.used", { percent })}</span>
        ) : (
          <Skeleton className="h-4 w-14 justify-self-end motion-reduce:animate-none" />
        )}
      </div>
      <div className="text-muted-foreground flex min-h-4 items-center justify-end text-xs">
        {window ? resets : <Skeleton className="h-3 w-32 motion-reduce:animate-none" />}
      </div>
    </div>
  )
}

/** The window label: "5 hours" / "Weekly" from the window length Codex reports. */
export function limitWindowLabel(window: RateLimitWindow, t: TFunction): string {
  const minutes = window.windowDurationMins
  if (minutes === null) return t("usage.usage")
  if (minutes % (24 * 60) === 0) return t("usage.windowDays", { count: minutes / (24 * 60) })
  return t("usage.windowHours", { count: Math.round(minutes / 60) })
}

export function CodexAccountSummary({
  account,
  disabled,
  onSignOut
}: {
  account: SettingsAccount | undefined
  disabled: boolean
  onSignOut: () => void
}) {
  const { t } = useTranslation()
  const loading = account === undefined
  const signedIn = account?.account.account ?? null
  const identity =
    signedIn === null
      ? t("usage.notSignedIn")
      : signedIn.type === "chatgpt"
        ? [signedIn.email, signedIn.planType !== "unknown" ? t(`usage.plan.${signedIn.planType}`) : null]
            .filter(Boolean)
            .join(" · ")
        : signedIn.type === "apiKey"
          ? t("usage.apiKey")
          : t("usage.bedrock")
  const limits = account?.rateLimits ?? null
  return (
    <section aria-busy={loading} aria-label="Codex" className="space-y-4">
      <div className="flex min-h-8 items-center justify-between gap-4">
        {loading ? (
          <Skeleton className="h-4 w-40 max-w-[65%] motion-reduce:animate-none" />
        ) : (
          <span className="min-w-0 text-sm break-words">{identity}</span>
        )}
        {loading ? (
          <Skeleton className="h-8 w-16 shrink-0 motion-reduce:animate-none" />
        ) : (
          signedIn !== null && (
            <Button variant="outline" size="sm" className="shrink-0" disabled={disabled} onClick={onSignOut}>
              {t("connection.signOut")}
            </Button>
          )
        )}
      </div>
      {(loading || signedIn !== null) && (
        <div className="flex flex-col gap-4">
          {loading ? (
            <UsageLimitRow />
          ) : limits === null ? (
            <span className="text-muted-foreground text-sm">{t("usage.unavailable")}</span>
          ) : (
            <>
              {limits.primary !== null && (
                <UsageLimitRow label={limitWindowLabel(limits.primary, t)} window={limits.primary} />
              )}
              {limits.secondary !== null && (
                <UsageLimitRow label={limitWindowLabel(limits.secondary, t)} window={limits.secondary} />
              )}
              {limits.primary === null && limits.secondary === null && (
                <span className="text-muted-foreground text-sm">{t("usage.unavailable")}</span>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function CodexProviderSection() {
  const agent = useSettingsAgent()
  const account = useSettingsAccount()
  const [signingOut, setSigningOut] = useState(false)
  return (
    <SettingGroup>
      <SettingLabel>Codex</SettingLabel>
      <div className="rounded-xl border p-4">
        <CodexAccountSummary
          account={account}
          disabled={agent == null || signingOut}
          onSignOut={() => {
            setSigningOut(true)
            void requestSignOut()
              .catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : String(error))
              })
              .finally(() => setSigningOut(false))
          }}
        />
        {account !== undefined && !account?.account.account && agent && (
          <LoginCard methods={agent.authMethods} signIn={requestSignIn} />
        )}
        {agent?.actions.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onRespond={(id, answer) => {
              void requestActionResponse(id, answer).catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : String(error))
              )
            }}
          />
        ))}
      </div>
    </SettingGroup>
  )
}
