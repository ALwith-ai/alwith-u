// External app shortcuts for the main chat menu; the chosen app is remembered.
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from "@/components/ui/dropdown-menu"
import { MenuRadioSelect } from "@/features/chat/composer/menu-radio"
import { type AppInfo, externalAppCandidates, openPathInApp, readAppsInfo } from "@/lib/open-with-app"
import { loadPreferences, savePreference } from "@/lib/preferences"

let cachedApps: AppInfo[] = []
let appsRequest: Promise<AppInfo[]> | null = null

/** Installed candidates, read once per session (plutil/sips over a dozen apps takes a moment). */
export function useExternalApps(enabled = true): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>(() => cachedApps)
  useEffect(() => {
    if (!enabled) return
    appsRequest ??= readAppsInfo(externalAppCandidates(), true).then(result => {
      cachedApps = result
      return result
    })
    let alive = true
    void appsRequest
      .then(result => {
        if (alive) setApps(result)
      })
      .catch((error: unknown) => {
        appsRequest = null
        if (alive) toast.error(describe(error))
      })
    return () => {
      alive = false
    }
  }, [enabled])
  return apps
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useProjectApps(cwd: string | null) {
  const apps = useExternalApps(cwd !== null)
  const [preferred, setPreferred] = useState<string | null>(null)
  const refresh = useCallback(() => {
    if (cwd === null) return
    void loadPreferences()
      .then(preferences => setPreferred(preferences.externalEditor))
      .catch((error: unknown) => toast.error(describe(error)))
  }, [cwd])
  useEffect(refresh, [refresh])
  const active = apps.find(app => app.bundle_id === preferred) ?? apps[0]

  const openWith = (app: AppInfo) => {
    if (cwd === null) throw new Error("Cannot open an external app without a project directory")
    setPreferred(app.bundle_id)
    void savePreference("externalEditor", app.bundle_id).catch((error: unknown) => toast.error(describe(error)))
    openPathInApp(app.bundle_id, cwd).catch((error: unknown) => toast.error(describe(error)))
  }

  return { apps, active, openWith, refresh }
}

function ProjectAppOptions({ editor }: { editor: ReturnType<typeof useProjectApps> }) {
  const { apps, active, openWith } = editor
  return (
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
  )
}

/** Main chat's overflow menu opens projects through the installed external apps. */
export function ExternalEditorMenu({
  editor,
  separator
}: {
  editor: ReturnType<typeof useProjectApps>
  separator: boolean
}) {
  const { t } = useTranslation()
  if (editor.apps.length === 0) return null
  return (
    <>
      {separator && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        <DropdownMenuSub
          onOpenChange={open => {
            if (open) editor.refresh()
          }}>
          <DropdownMenuSubTrigger openOnHover delay={100}>
            {editor.active?.icon && <img src={editor.active.icon} alt="" className="size-5" />}
            {t("actions.open")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            <ProjectAppOptions editor={editor} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  )
}
