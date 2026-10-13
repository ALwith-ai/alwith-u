// ALwith Desktop's DraftProjectPicker reduced: the empty draft's project capsule. Shows the
// draft's folder name (or "Select project"), lists recent projects, and offers the folder
// dialog. The host prepares the default workspace when no previous project was selected.
import { invoke } from "@tauri-apps/api/core"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { FolderClosedIcon, FolderPlusIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Pane } from "@/components/alwith-ui/pane"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useThreadsUiStore } from "@/features/threads/store"
import { isQuickChatDirectory } from "@/features/threads/thread-groups"
import { basename } from "@/lib/path"

export async function chooseFolder(defaultPath: string | null): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false, defaultPath: defaultPath ?? undefined })
  return typeof picked === "string" ? picked : null
}

export function DraftProjectPicker({
  cwd,
  recentProjects,
  onChange
}: {
  cwd: string | null
  recentProjects: string[]
  onChange: (cwd: string) => void
}) {
  const { t } = useTranslation()
  const windowsTempDirectory = useThreadsUiStore(state => state.windowsTempDirectory)
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void invoke<string>("draft_directory", { cwd: null }).then(
      path => {
        if (active) setDefaultCwd(path)
      },
      error => {
        if (active) toast.error(String(error))
      }
    )
    return () => {
      active = false
    }
  }, [])
  const projects = [...(cwd !== null ? [cwd] : []), ...recentProjects.filter(path => path !== cwd)].filter(
    path => path !== defaultCwd && !isQuickChatDirectory(path, windowsTempDirectory)
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-7 max-w-full gap-1.5 px-2 text-sm font-normal" />}>
        <FolderClosedIcon data-icon="inline-start" />
        <span className="truncate">
          {cwd === null || cwd === defaultCwd ? t("chat.draft.selectProject") : basename(cwd)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72 overflow-hidden">
        {projects.length > 0 && (
          <>
            <Pane className="flex-none" viewportClassName="max-h-64">
              <DropdownMenuRadioGroup value={cwd ?? ""} onValueChange={onChange}>
                {projects.map(path => (
                  <DropdownMenuRadioItem key={path} value={path} title={path} closeOnClick>
                    <FolderClosedIcon />
                    <span className="truncate">{basename(path)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </Pane>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void chooseFolder(cwd).then(path => {
                if (path !== null) onChange(path)
              })
            }}>
            <FolderPlusIcon />
            {t("chat.draft.newProject")}
          </DropdownMenuItem>
          {defaultCwd !== null && cwd !== null && cwd !== defaultCwd && (
            <DropdownMenuItem onClick={() => onChange(defaultCwd)}>
              <XIcon />
              {t("chat.draft.workOutsideProject")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
