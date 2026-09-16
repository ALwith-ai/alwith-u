// "Open in …" for the chat's project: ALwith Desktop's OpenInEditorButton reduced to one
// dropdown on the project name — reveal in the file manager, then every installed candidate
// app as a radio list; the chosen app is remembered as the preferred external editor.
import { ChevronDownIcon, FolderIcon, FolderOpenIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MenuRadioSelect } from "@/features/chat/composer/menu-radio"
import { revealInFinder } from "@/lib/open"
import { type AppInfo, externalAppCandidates, openPathInApp, readAppsInfo } from "@/lib/open-with-app"
import { basename } from "@/lib/path"
import { loadPreferences, savePreference } from "@/lib/preferences"

let cachedApps: Promise<AppInfo[]> | null = null

/** Installed candidates, read once per session (plutil/sips over a dozen apps takes a moment). */
export function useExternalApps(): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>([])
  useEffect(() => {
    cachedApps ??= readAppsInfo(externalAppCandidates(), true)
    let alive = true
    void cachedApps.then(result => {
      if (alive) setApps(result)
    })
    return () => {
      alive = false
    }
  }, [])
  return apps
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ProjectMenu({ cwd }: { cwd: string }) {
  const { t } = useTranslation()
  const apps = useExternalApps()
  const [preferred, setPreferred] = useState<string | null>(null)
  useEffect(() => {
    void loadPreferences().then(preferences => setPreferred(preferences.externalEditor))
  }, [])
  const active = apps.find(app => app.bundle_id === preferred) ?? apps[0]

  const openWith = (app: AppInfo) => {
    setPreferred(app.bundle_id)
    void savePreference("externalEditor", app.bundle_id)
    openPathInApp(app.bundle_id, cwd).catch((error: unknown) => toast.error(describe(error)))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex max-w-full items-center gap-1 truncate text-xs"
                />
              }>
              <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{basename(cwd)}</span>
              <ChevronDownIcon className="size-3 shrink-0 opacity-60" aria-hidden="true" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>{cwd}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void revealInFinder(cwd)}>
            <FolderOpenIcon />
            {t("actions.reveal")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {apps.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("chat.openIn")}</DropdownMenuLabel>
            <MenuRadioSelect
              value={active?.bundle_id ?? ""}
              onValueChange={value => {
                const app = apps.find(item => item.bundle_id === value)
                if (app) openWith(app)
              }}
              options={apps.map(app => ({
                value: app.bundle_id,
                label: app.name,
                icon: app.icon ? <img src={app.icon} alt="" className="size-5 shrink-0" /> : undefined
              }))}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
