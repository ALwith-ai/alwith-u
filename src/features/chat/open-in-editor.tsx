// External app shortcuts for the main chat menu; the chosen app is remembered.
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"
import { openPath } from "@tauri-apps/plugin-opener"
import { FolderOpenIcon } from "lucide-react"
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
import { projectAppPreference, setProjectAppPreference } from "@/lib/project-app-preference"
import i18n from "@/lib/i18n"

let cachedApps: AppInfo[] = []
let appsRequest: Promise<AppInfo[]> | null = null

function loadApps(): Promise<AppInfo[]> {
  appsRequest ??= readAppsInfo(externalAppCandidates(), true)
    .then(result => {
      cachedApps = result
      return result
    })
    .catch(error => {
      appsRequest = null
      throw error
    })
  return appsRequest
}

/** Installed candidates, read once per session (plutil/sips over a dozen apps takes a moment). */
export function useExternalApps(enabled = true): AppInfo[] {
  const [apps, setApps] = useState<AppInfo[]>(() => cachedApps)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void loadApps()
      .then(result => {
        if (alive) setApps(result)
      })
      .catch((error: unknown) => {
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
  const preferred = useStore(projectAppPreference, state => state.preferred)
  const refresh = useCallback(() => {
    if (cwd === null) return
    const revision = projectAppPreference.getState().revision
    void loadPreferences()
      .then(preferences => {
        if (projectAppPreference.getState().revision === revision) setProjectAppPreference(preferences.externalEditor)
      })
      .catch((error: unknown) => toast.error(describe(error)))
  }, [cwd])
  useEffect(refresh, [refresh])
  const active = preferred === null ? apps[0] : apps.find(app => app.bundle_id === preferred)

  const openWith = (app: AppInfo) => {
    if (cwd === null) throw new Error("Cannot open an external app without a project directory")
    setProjectAppPreference(app.bundle_id)
    void savePreference("externalEditor", app.bundle_id).catch((error: unknown) => toast.error(describe(error)))
    openPathInApp(app.bundle_id, cwd).catch((error: unknown) => toast.error(describe(error)))
  }

  const openPreferred = async () => {
    if (cwd === null) throw new Error("Cannot open an external app without a project directory")
    // Read at click time as well: a newly mounted popup must not open the old default.
    const preferences = await loadPreferences()
    const available = await loadApps()
    const selected = preferences.externalEditor
    const app = selected === null ? available[0] : available.find(item => item.bundle_id === selected)
    if (!app && selected !== null) throw new Error(i18n.t("actions.projectAppUnavailable"))
    if (app) await openPathInApp(app.bundle_id, cwd)
    else await openPath(cwd)
  }

  return { apps, active, openWith, openPreferred, refresh }
}

export function ProjectAppIcon({ app }: { app: AppInfo | undefined }) {
  return app?.icon ? (
    <img src={app.icon} alt="" className="size-4 shrink-0 object-contain" />
  ) : (
    <FolderOpenIcon className="size-4" />
  )
}

function ProjectAppOptions({ editor }: { editor: ReturnType<typeof useProjectApps> }) {
  const { apps, active, openWith } = editor
  const orderedApps = active ? [active, ...apps.filter(app => app.bundle_id !== active.bundle_id)] : apps
  return (
    <MenuRadioSelect
      value={active?.bundle_id ?? ""}
      onValueChange={value => {
        const app = apps.find(item => item.bundle_id === value)
        if (app) openWith(app)
      }}
      options={orderedApps.map(app => ({
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
