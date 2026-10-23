import { useState } from "react"
import { useTranslation } from "react-i18next"

import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useComputerStatus } from "@/features/computer/computer-control"
import { enableComputer, reconnectComputer, stopComputer } from "@/features/computer/operations"
import { isMac } from "@/lib/platform"

import { SettingGroup, SettingRow } from "./shared"

export function ComputerSection() {
  const { t } = useTranslation()
  const { status, error: statusError } = useComputerStatus()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = pending || status?.phase === "verifying" || status?.phase === "stopping"
  const permitted = status?.permissions.accessibility && status.permissions.screenCapture
  const perform = async (operation: () => Promise<unknown>) => {
    setError(null)
    try {
      await operation()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const toggle = async (enabled: boolean) => {
    setPending(true)
    try {
      await perform(enabled ? enableComputer : stopComputer)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <SettingGroup>
          <SettingRow title={t("computer.title")} desc={t("computer.description")}>
            <Switch
              aria-label={t("computer.enable")}
              checked={status?.enabled === true}
              disabled={
                busy || (!status?.enabled && (!status?.available || !status.permissions.supported || !permitted))
              }
              onCheckedChange={(value) => void toggle(value)}
            />
          </SettingRow>
          <p className="py-3 text-xs leading-5 text-muted-foreground">{t("computer.scope")}</p>
          {status && !status.permissions.supported && <p className="text-sm">{t("computer.unsupported")}</p>}
          {status && !status.available && <p className="text-sm">{t("computer.missing")}</p>}
          {status?.permissions.supported && !permitted && (
            <p className="text-sm text-muted-foreground">{t("computer.permissions")}</p>
          )}
          {isMac() &&
            status?.permissions.supported &&
            (["accessibility", "screenCapture"] as const).map((permission) => (
              <SettingRow
                key={permission}
                title={t(`computer.${permission}`)}
                desc={t(status.permissions[permission] ? "computer.granted" : "computer.notGranted")}
              >
                <div className="flex gap-2">
                  {!status.permissions[permission] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void perform(() =>
                          commands.computerRequestPermissions({
                            permission,
                            request: true
                          })
                        )
                      }
                    >
                      {t("computer.grantPermissions")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void perform(() =>
                        commands.computerRequestPermissions({
                          permission,
                          request: false
                        })
                      )
                    }
                  >
                    {t("computer.openSettings")}
                  </Button>
                </div>
              </SettingRow>
            ))}
          {status?.available && status.permissions.supported && (
            <SettingRow title={t("computer.connection")} desc={t(`computer.phases.${status.phase ?? "disabled"}`)}>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !permitted}
                onClick={() => {
                  setPending(true)
                  void perform(reconnectComputer).finally(() => setPending(false))
                }}
              >
                {busy ? t("computer.verifying") : t("computer.reconnect")}
              </Button>
            </SettingRow>
          )}
          <p className="py-3 text-xs text-muted-foreground">{t("computer.reconnectHint")}</p>
          {status?.lastError && (
            <p role="alert" className="text-sm text-destructive">
              {status.lastError}
            </p>
          )}
          {status?.diagnostics?.trim() && (
            <details className="py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t("computer.diagnostics")}</summary>
              <pre className="mt-2 max-h-48 overflow-auto break-all whitespace-pre-wrap">{status.diagnostics}</pre>
            </details>
          )}
          {(error || statusError) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? statusError}
            </p>
          )}
        </SettingGroup>
      </div>
    </div>
  )
}
