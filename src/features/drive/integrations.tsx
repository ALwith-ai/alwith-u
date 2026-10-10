import { useEffect, useState, type ReactNode } from "react"
import { emitTo } from "@tauri-apps/api/event"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { driveTranslator, useDrive } from "@alwith/module-drive/react"
import type { ArchiveStatus, Preferences } from "@alwith/module-drive"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { drive } from "./controller"

export function DriveIntegrations(): ReactNode {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const t = driveTranslator(zh ? "zh-CN" : "en", "settings")
  const { snapshot } = useDrive(drive)
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [archive, setArchive] = useState<ArchiveStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload account-scoped data after native generation changes.
  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      const [settings, status] = await Promise.all([
        drive.request({ type: "preferences" }),
        drive.request({ type: "archiveStatus" })
      ])
      if (settings.type !== "preferences" || status.type !== "archiveStatus")
        throw new Error("Invalid Drive integration settings")
      if (active) {
        setPreferences(settings.data)
        setArchive(status.data)
      }
    }
    const refresh = (): void => {
      void load().catch((cause: unknown) => {
        if (active) setError(String(cause))
      })
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [snapshot?.generation])
  const change = (key: keyof Preferences, value: boolean): void => {
    if (!preferences || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      if (
        key === "sessionArchive" &&
        value &&
        !(await confirm(
          zh
            ? "开启后，每五分钟将 Codex 会话中的用户消息和助手文字回复上传到配置的云盘服务器。思考和工具记录不上传；可在会话菜单中排除私密会话。确认开启？"
            : "Upload Codex prompts and assistant text replies to the configured Drive server every five minutes? Reasoning and tool records are excluded. Private conversations can be excluded in the chat menu.",
          { title: t("archive.title"), kind: "warning" }
        ))
      )
        return
      const response = await drive.request({ type: "setPreferences", ...preferences, [key]: value })
      if (response.type !== "preferences") throw new Error("Invalid Drive preferences")
      setPreferences(response.data)
      if (key === "sessionArchive" && value) await emitTo("main", "drive:archive-sync")
    })()
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setBusy(false))
  }
  return (
    <section>
      <h3>{t("ai.title")}</h3>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="alwith-drive-setting">
        <div>
          <strong>{t("archive.title")}</strong>
          <p>
            {zh
              ? "经同意后每五分钟归档 Codex 的用户消息和助手文字回复。不保留本地会话副本；可在会话菜单中排除私密会话。"
              : "Opt in to archive Codex prompts and assistant text replies every five minutes. No second local history is stored. Exclude private conversations in the chat menu."}
          </p>
          {archive && (
            <p>
              {t("archive.synced", { count: archive.synced })} ·{" "}
              {t("archive.lastUpload", {
                time: archive.lastUploadAt
                  ? new Date(archive.lastUploadAt).toLocaleString(i18n.language)
                  : t("archive.never")
              })}
            </p>
          )}
          {archive?.lastError && <p role="alert">{archive.lastError}</p>}
        </div>
        <Switch
          aria-label={t("archive.title")}
          checked={preferences?.sessionArchive ?? false}
          disabled={busy || !preferences}
          onCheckedChange={value => change("sessionArchive", value)}
        />
      </div>
      {preferences?.sessionArchive && (
        <Button
          variant="outline"
          onClick={() => {
            void emitTo("main", "drive:archive-sync").catch((cause: unknown) => setError(String(cause)))
          }}>
          {t("archive.syncNow")}
        </Button>
      )}
      <div className="alwith-drive-setting">
        <div>
          <strong>{t("knowledge.title")}</strong>
          <p>{t("knowledge.desc")}</p>
        </div>
        <Switch
          aria-label={t("knowledge.title")}
          checked={preferences?.knowledgeInject ?? false}
          disabled={busy || !preferences}
          onCheckedChange={value => change("knowledgeInject", value)}
        />
      </div>
    </section>
  )
}
