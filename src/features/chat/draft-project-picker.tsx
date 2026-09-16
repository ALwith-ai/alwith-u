// ALwith Desktop's DraftProjectPicker reduced: the empty draft's project capsule. Shows the
// draft's folder name (or "Select project"), lists recent projects, and offers the folder
// dialog. Codex has no default workspace, so a folder must be chosen before the first send.
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { FolderClosedIcon, FolderPlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
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
  const projects = [...(cwd !== null ? [cwd] : []), ...recentProjects.filter(path => path !== cwd)]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-sm font-normal" />}>
        <FolderClosedIcon data-icon="inline-start" />
        {cwd === null ? t("chat.draft.selectProject") : basename(cwd)}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-72 overflow-hidden">
        {projects.length > 0 && (
          <>
            <div className="max-h-64 overflow-y-auto">
              <DropdownMenuGroup>
                {projects.map(path => (
                  <DropdownMenuItem key={path} onClick={() => onChange(path)}>
                    <FolderClosedIcon />
                    {basename(path)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </div>
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
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
