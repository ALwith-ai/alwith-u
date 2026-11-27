// Claude: who is signed in with a Claude subscription and how much of its limits is used, with
// the browser sign-in when nobody is. The adapter owns the login; this card asks it through the
// provider settings.
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { describeProviderError as describe, logProviderError } from "@/lib/provider-errors"
import { claudeLogin, claudeLogout, claudeUsage, type ProviderSnapshot, type ProviderUsage } from "@/lib/providers"

import { limitWindowLabel, UsageLimitRow } from "./codex-provider-section"
import { SettingGroup, SettingLabel } from "./shared"

/** `undefined` while Claude is asked, `null` when it reported no usage. */
function useClaudeUsage(account: string | null): ProviderUsage | null | undefined {
  const [usage, setUsage] = useState<ProviderUsage | null>()
  useEffect(() => {
    setUsage(undefined)
    if (account === null) return
    let current = true
    claudeUsage().then(
      (result) => {
        if (current) setUsage(result)
      },
      (error: unknown) => {
        logProviderError("claude-usage", error)
        if (current) setUsage(null)
      }
    )
    return () => {
      current = false
    }
  }, [account])
  return usage
}

export function ClaudeProviderSection({
  snapshot,
  disabled
}: {
  snapshot: ProviderSnapshot | null
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [running, setRunning] = useState(false)
  const login = snapshot?.providers["anthropic"]?.login
  // A different account reads its own usage; the same account keeps what is shown.
  const usage = useClaudeUsage(login ? `${login.email ?? ""}\n${login.plan ?? ""}` : null)
  const run = async (request: (revision: number) => Promise<ProviderSnapshot>, revision: number) => {
    setRunning(true)
    try {
      const result = await request(revision)
      if (result.error) {
        logProviderError("claude-login", result.error)
        toast.error(describe(result.error))
      }
    } catch (error) {
      logProviderError("claude-login", error)
      toast.error(describe(error))
    } finally {
      setRunning(false)
    }
  }
  return (
    <SettingGroup>
      <SettingLabel>Claude</SettingLabel>
      <div className="rounded-xl border p-4">
        <section aria-busy={snapshot === null} aria-label="Claude" className="space-y-4">
          <div className="flex min-h-8 items-center justify-between gap-4">
            {snapshot === null ? (
              <Skeleton className="h-4 w-40 max-w-[65%] motion-reduce:animate-none" />
            ) : (
              <span className="min-w-0 text-sm break-words">
                {login
                  ? [
                      login.email ?? t("provider.subscription.signedIn"),
                      login.plan === null
                        ? null
                        : t(`provider.subscription.plan.${login.plan}`, { defaultValue: login.plan })
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : t("usage.notSignedIn")}
              </span>
            )}
            {snapshot !== null && login && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={disabled || running}
                onClick={() => void run(claudeLogout, snapshot.revision)}
              >
                {t("connection.signOut")}
              </Button>
            )}
          </div>
          {login && (
            <div className="flex flex-col gap-4">
              {usage === undefined ? (
                <UsageLimitRow />
              ) : usage === null || usage.windows.length === 0 ? (
                <span className="text-sm text-muted-foreground">{t("usage.unavailable")}</span>
              ) : (
                usage.windows.map((window) => (
                  <UsageLimitRow
                    key={`${window.label ?? ""}:${window.windowDurationMins}`}
                    label={window.label ?? limitWindowLabel(window, t)}
                    window={window}
                  />
                ))
              )}
            </div>
          )}
        </section>
        {snapshot !== null && !login && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("provider.subscription.signIn")}</EmptyTitle>
              <EmptyDescription>
                {t(running ? "provider.subscription.waiting" : "provider.subscription.description")}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              className="transition-colors"
              disabled={disabled || running}
              aria-busy={running}
              onClick={() => void run(claudeLogin, snapshot.revision)}
            >
              <span data-icon="inline-start" className="flex size-4 shrink-0 items-center justify-center">
                {running && <Spinner />}
              </span>
              <span>{t("provider.subscription.signIn")}</span>
            </Button>
          </Empty>
        )}
      </div>
    </SettingGroup>
  )
}
