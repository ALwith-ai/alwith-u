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
            size="icon-xs"
            className="main-client-version-button text-muted-foreground hover:text-foreground"
            aria-label={t("settings.about")}
            title={t("settings.about")}
          />
        }
      >
        <TerminalIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={4}
        className="w-auto gap-1 p-3"
        aria-label={t("settings.about")}
      >
        <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-green-500" />
          <span>ALwith U</span>
          <span className="text-right tabular-nums">{clientVersion === null ? "—" : `v${clientVersion}`}</span>
          <span aria-hidden className="size-1.5 rounded-full bg-green-500" />
          <span>Codex CLI</span>
          <span className="text-right tabular-nums">{cliVersion ?? "—"}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
