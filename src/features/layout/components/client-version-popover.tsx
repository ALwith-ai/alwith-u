import { getVersion } from "@tauri-apps/api/app"
import { isTauri } from "@tauri-apps/api/core"
import { CircleHelpIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { useApp } from "@/lib/client"

/** 右下角的轻量状态入口：版本从运行中的桌面客户端与 ACP 初始化结果分别读取。 */
export function ClientVersionPopover() {
  const { t } = useTranslation()
  const [clientVersion, setClientVersion] = useState<string | null>(null)
  const cliVersion = useApp(state => state.agent?.info.version ?? null)

  useEffect(() => {
    if (!isTauri()) return
    void getVersion().then(setClientVersion)
  }, [])

  return (
    <Popover>
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
        <CircleHelpIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={4} className="w-64 gap-2">
        <PopoverTitle>{t("settings.about")}</PopoverTitle>
        <div className="text-muted-foreground grid gap-1 text-xs">
          <span>{t("settings.version", { version: clientVersion === null ? "—" : `v${clientVersion}` })}</span>
          <span>{t("settings.codexVersion", { version: cliVersion ?? "—" })}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
