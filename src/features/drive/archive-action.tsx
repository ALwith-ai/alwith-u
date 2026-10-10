import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"
import { useDrive } from "@alwith/module-drive/react"
import { HoverInfoAction } from "@/components/alwith-ui/hover-info-card"
import { drive } from "./controller"
import { useDriveVisible } from "./use-drive-visible"

export function DriveArchiveAction({ sessionId }: { sessionId: string }): ReactNode {
  const visible = useDriveVisible()
  const { connected, snapshot } = useDrive(drive)
  const { i18n } = useTranslation()
  const [excluded, setExcluded] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload account-scoped data after native generation changes.
  useEffect(() => {
    if (!connected || !visible || !snapshot?.configured) {
      setExcluded(null)
      return
    }
    let active = true
    void drive
      .request({ type: "archivePrivateSessions" })
      .then(response => {
        if (response.type !== "archivePrivateSessions") throw new Error("Invalid private session list")
        if (active) setExcluded(response.data.includes(sessionId))
      })
      .catch((error: unknown) => {
        if (active) toast.error(String(error))
      })
    return () => {
      active = false
    }
  }, [connected, visible, snapshot?.configured, snapshot?.generation, sessionId])
  if (!visible || !snapshot?.configured) return null
  const zh = i18n.language.startsWith("zh")
  const label = excluded
    ? zh
      ? "允许云盘归档此会话"
      : "Allow Drive archive for this chat"
    : zh
      ? "不归档此私密会话"
      : "Exclude this private chat from Drive archive"
  return (
    <HoverInfoAction
      icon={<ShieldCheckIcon />}
      label={label}
      disabled={!connected || busy || excluded === null}
      onClick={() => {
        setBusy(true)
        void drive
          .request({ type: "setArchivePrivate", sessionId, private: !excluded })
          .then(() => setExcluded(!excluded))
          .catch((error: unknown) => toast.error(String(error)))
          .finally(() => setBusy(false))
      }}
    />
  )
}
