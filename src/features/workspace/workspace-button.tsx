import { PanelsTopLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

import { useWorkspace } from "./context"
export function WorkspaceButton() {
  const workspace = useWorkspace()
  const { t } = useTranslation()
  if (workspace === null) return null
  const bothVisible = workspace.visible && !workspace.viewMode
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="workspace-sidebar-toggle"
      aria-label={t(bothVisible ? "workspace.closeWorkspace" : "workspace.openWorkspace")}
      title={t(bothVisible ? "workspace.closeWorkspace" : "workspace.openWorkspace")}
      aria-expanded={workspace.visible}
      aria-controls="file-workspace-panel"
      onClick={workspace.toggle}
    >
      <PanelsTopLeft className="size-4" />
    </Button>
  )
}
