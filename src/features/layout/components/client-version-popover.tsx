import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { TerminalIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** Lightweight status entry at the bottom right, showing the client version and the Codex executable version actually used by Runtime. */
export function ClientVersionPopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [clientVersion, setClientVersion] = useState<string | null>(null)
  const [cliVersion, setCliVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !isTauri()) return
    let disposed = false
    void Promise.all([getVersion(), commands.codexVersion()])
      .then(([client, cli]) => {
        if (disposed) return
        setClientVersion(client)
        setCliVersion(cli)
      })
      .catch((error: unknown) => {
        if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            aria-label={t("settings.about")}
            title={t("settings.about")}
          />
        }>
        <TerminalIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={4}
        className="w-auto min-w-48 gap-2"
        aria-label={t("settings.about")}>
        <div className="text-muted-foreground grid gap-1 text-xs">
          <span>{t("settings.version", { version: clientVersion === null ? "—" : `v${clientVersion}` })}</span>
          <span>{t("settings.codexVersion", { version: cliVersion ?? "—" })}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
