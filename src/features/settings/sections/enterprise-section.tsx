import { listen } from "@tauri-apps/api/event"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { logEnterpriseError, traceEnterprise } from "@/features/auth/enterprise-diagnostics"
import {
  enterpriseLoginAvailable,
  type EnterpriseRenewal,
  type EnterpriseStatus,
  parseEnterpriseRenewal,
  parseEnterpriseStatus
} from "@/features/auth/enterprise-status"
import { requestEnterpriseProviderRefresh, usePlatformAuth } from "@/features/auth/store"
import { openExternal } from "@/lib/open"

import { SettingGroup, SettingRow } from "./shared"

function enterpriseGeneration(value: unknown): number {
  if (typeof value !== "object" || value === null || !("generation" in value) || typeof value.generation !== "number")
    throw new Error("Enterprise account is not ready")
  return value.generation
}
export function EnterpriseSection() {
  const { t } = useTranslation()
  const user = usePlatformAuth((state) => state.user)
  const account = user?.user_uuid
  const [status, setStatus] = useState<EnterpriseStatus | null>(null)
  const [renewal, setRenewal] = useState<EnterpriseRenewal | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState<{
    state: string
    generation: number
  } | null>(null)
  useEffect(() => {
    let active = true
    let checking = false
    let lastFailure: string | null = null
    setBusy(false)
    setConfirm(false)
    setError(false)
    setStatus(null)
    setRenewal(null)
    setPending(null)
    const check = async () => {
      if (!account || checking) return
      checking = true
      try {
        const native = await commands.enterpriseStatus()
        if (!active || usePlatformAuth.getState().user !== user) return
        const server = parseEnterpriseStatus(native)
        const parsed = parseEnterpriseRenewal(native)
        setStatus(server)
        setRenewal(parsed)
        setError(false)
        if (!parsed.error) lastFailure = null
        if (parsed.error) {
          if (lastFailure !== parsed.error) logEnterpriseError("renewal-status", parsed.error)
          lastFailure = parsed.error
        }
        if (enterpriseLoginAvailable(server, parsed)) setPending(null)
      } catch (reason) {
        const failure = String(reason)
        if (lastFailure !== failure) logEnterpriseError("settings-status", reason)
        lastFailure = failure
        if (active) setError(true)
      } finally {
        checking = false
      }
    }
    void check()
    const interval = setInterval(() => void check(), 3000)
    const focus = () => void check()
    window.addEventListener("focus", focus)
    return () => {
      active = false
      clearInterval(interval)
      window.removeEventListener("focus", focus)
    }
  }, [account, user, revision])

  useEffect(() => {
    if (!pending) return
    let active = true
    const stop = listen<Record<string, unknown>>("enterprise:event", ({ payload }) => {
      if (
        !active ||
        payload.type !== "enterpriseLoginCompleted" ||
        payload.accountId !== account ||
        payload.generation !== pending.generation
      )
        return
      setPending(null)
      if (payload.error) logEnterpriseError("login-completed", payload.error)
      setError(Boolean(payload.error))
      setRevision((value) => value + 1)
    })
    void stop.catch((reason) => {
      logEnterpriseError("settings-events", reason)
      if (active) setError(true)
    })
    return () => {
      active = false
      void stop.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [account, pending])

  async function run(action: "login" | "logout" | "cancel") {
    const identity = usePlatformAuth.getState().user
    const current = () => usePlatformAuth.getState().user === identity
    setBusy(true)
    setError(false)
    try {
      if (action === "login") {
        await traceEnterprise("refresh-enterprise", requestEnterpriseProviderRefresh)
        if (!current()) return
        const fresh = await commands.enterpriseStatus()
        if (!current()) return
        const generation = enterpriseGeneration(fresh)
        const result = await traceEnterprise("begin-browser", () => commands.enterpriseBegin({ generation }))
        if (
          typeof result !== "object" ||
          result === null ||
          Array.isArray(result) ||
          typeof result.authorization_url !== "string" ||
          typeof result.state !== "string"
        )
          throw new Error("Invalid enterprise login response")
        if (!current()) return
        setPending({ state: result.state, generation })
        const authorizationUrl = result.authorization_url
        await traceEnterprise("open-browser", () => openExternal(authorizationUrl))
      } else if (action === "cancel") {
        if (!current()) return
        if (pending !== null)
          await commands.enterpriseCancel({
            generation: pending.generation,
            state: pending.state
          })
        setPending(null)
      } else {
        const fresh = await commands.enterpriseStatus()
        if (!current()) return
        await commands.enterpriseLogout({
          generation: enterpriseGeneration(fresh)
        })
        if (!current()) return

        setConfirm(false)
        setRevision((value) => value + 1)
      }
    } catch (reason) {
      logEnterpriseError(`settings-${action}`, reason)
      if (current()) setError(true)
    } finally {
      if (current()) setBusy(false)
    }
  }
  const authorized = !error && status !== null && renewal !== null && enterpriseLoginAvailable(status, renewal)
  const label = error
    ? t("enterprise.unknown")
    : authorized
      ? (status.email ?? t("enterprise.authorized"))
      : pending !== null
        ? t("enterprise.pending")
        : status === null
          ? t("enterprise.checking")
          : !status.enabled
            ? t("enterprise.disabled")
            : t("enterprise.signedOut")
  return (
    <SettingGroup>
      <SettingRow title={t("enterprise.title")} desc={label}>
        <div className="flex gap-2">
          {pending !== null ? (
            <Button variant="outline" disabled={busy} onClick={() => void run("cancel")}>
              {t("enterprise.cancel")}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={busy || !account || (!error && status === null) || status?.enabled === false}
              onClick={() => (authorized ? setConfirm(true) : void run("login"))}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t(authorized ? "enterprise.logout" : "enterprise.login")}
            </Button>
          )}
          {error && (
            <Button variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
              {t("actions.retry")}
            </Button>
          )}
        </div>
      </SettingRow>
      {authorized && <p className="text-xs text-muted-foreground">{t("enterprise.accountHint")}</p>}
      {(error || renewal?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {t("enterprise.error")}
        </p>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("enterprise.logout")}</DialogTitle>
            <DialogDescription>{t("enterprise.logoutHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              {t("enterprise.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void run("logout")}>
              {t("enterprise.logout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingGroup>
  )
}
