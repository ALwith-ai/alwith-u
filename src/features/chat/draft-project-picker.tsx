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
import { isQuickChatDirectory } from "@/features/threads/thread-groups"
import { basename } from "@/lib/path"
import { cn } from "@/lib/utils"

export async function chooseFolder(defaultPath: string | null): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false, defaultPath: defaultPath ?? undefined })
  return typeof picked === "string" ? picked : null
}

export function DraftProjectPicker({
  cwd,
  recentProjects,
  onChange,
  preparing = false
}: {
  cwd: string | null
  recentProjects: string[]
  onChange: (cwd: string) => void
  preparing?: boolean
}) {
  const { t } = useTranslation()
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void invoke<string>("draft_directory", { cwd: null }).then(
      (path) => {
        if (active) setDefaultCwd(path)
      },
      (error) => {
        if (active) toast.error(String(error))
      }
    )
    return () => {
      active = false
    }
  }, [])
  const projects = [...(cwd !== null ? [cwd] : []), ...recentProjects.filter((path) => path !== cwd)].filter(
    (path) => path !== defaultCwd && !isQuickChatDirectory(path)
  )
  const hasProject = cwd !== null && cwd !== defaultCwd
  const workOutsideProject = (): void => {
    if (defaultCwd === null) throw new Error("The default draft directory is not ready")
    onChange(defaultCwd)
  }
  return (
    <DropdownMenu>
      <div
        aria-busy={preparing}
        className={cn(
          "chat-project-picker group/project inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2",
          hasProject ? "text-foreground" : "text-foreground/65"
        )}
      >
        {hasProject && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative size-4 rounded-full p-0 hover:bg-transparent dark:hover:bg-transparent"
            aria-label={t("chat.draft.workOutsideProject")}
            title={t("chat.draft.workOutsideProject")}
            disabled={defaultCwd === null}
            onClick={workOutsideProject}
          >
            <FolderClosedIcon className="size-4 group-hover/project:opacity-0" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-muted-foreground text-background opacity-0 group-hover/project:opacity-100">
              <XIcon className="size-3" />
            </span>
          </Button>
        )}
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 shrink gap-1.5 rounded-full p-0 text-sm font-normal text-inherit hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
            />
          }
        >
          {!hasProject && <FolderClosedIcon className="size-4" />}
          <span className="truncate">{hasProject ? basename(cwd) : t("chat.draft.selectProject")}</span>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent side="top" align="start" className="w-72 overflow-hidden">
        {projects.length > 0 && (
          <>
            <Pane className="flex-none" viewportClassName="max-h-64 pe-0">
              <DropdownMenuRadioGroup value={cwd ?? ""} onValueChange={onChange}>
                {projects.map((path) => (
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
              void chooseFolder(cwd).then((path) => {
                if (path !== null) onChange(path)
              })
            }}
          >
            <FolderPlusIcon />
            {t("chat.draft.newProject")}
          </DropdownMenuItem>
          {defaultCwd !== null && cwd !== null && cwd !== defaultCwd && (
            <DropdownMenuItem onClick={workOutsideProject}>
              <XIcon />
              {t("chat.draft.workOutsideProject")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
