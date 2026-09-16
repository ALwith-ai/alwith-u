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
  useSettingsAgent
} from "@/lib/settings-bridge"
import { LoginCard } from "@/features/connection/login-card"
import { ActionCard } from "@/features/chat/action-card"
import { SettingGroup, SettingLabel } from "./shared"

/** Desktop's `UsageLimitRow`: label, a long bar, "n% used", then the reset time under it. */
export function UsageLimitRow({ label, window }: { label: string; window: RateLimitWindow }) {
  const { t } = useTranslation()
  const percent = Math.round(Math.min(100, Math.max(0, window.usedPercent)))
  const resets =
    window.resetsAt !== null
      ? t("usage.resetsAt", { time: format(new Date(window.resetsAt * 1000), "yyyy/MM/dd HH:mm") })
      : null
  return (
    <div>
      <div className="flex items-center gap-6">
        <div className="shrink-0 text-sm">{label}</div>
        <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
          <div className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-muted-foreground shrink-0 text-sm tabular-nums">{t("usage.used", { percent })}</span>
      </div>
      {resets !== null && <div className="text-muted-foreground/60 mt-1.5 text-end text-[13px]">{resets}</div>}
    </div>
  )
}

function UsageLimitRowSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-6">
        <Skeleton className="h-4 w-12 shrink-0" />
        <Skeleton className="h-2 flex-1 rounded-full" />
        <Skeleton className="h-4 w-14 shrink-0" />
      </div>
      <div className="mt-1.5 flex justify-end">
        <Skeleton className="h-3 w-40" />
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

export function CodexProviderSection() {
  const { t } = useTranslation()
  const agent = useSettingsAgent()
  const account = useSettingsAccount()
  const [signingOut, setSigningOut] = useState(false)
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
    <div className="flex flex-col gap-4">
      <SettingGroup>
        <SettingLabel>Codex</SettingLabel>
        <div className="flex items-center justify-between gap-2 py-2.5">
          {loading ? <Skeleton className="h-4 w-40" /> : <span className="text-sm">{identity}</span>}
          {signedIn !== null && (
            <Button
              variant="outline"
              size="sm"
              disabled={agent == null || signingOut}
              onClick={async () => {
                setSigningOut(true)
                try {
                  await requestSignOut()
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error))
                } finally {
                  setSigningOut(false)
                }
              }}>
              {t("connection.signOut")}
            </Button>
          )}
        </div>
        {signedIn !== null && (
          <div className="flex flex-col gap-4 pb-2.5">
            {loading ? (
              <UsageLimitRowSkeleton />
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
        {!loading && signedIn === null && agent && <LoginCard methods={agent.authMethods} signIn={requestSignIn} />}
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
      </SettingGroup>
    </div>
  )
}
