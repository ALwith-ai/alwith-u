import { PanelRightDashedIcon, PanelRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "./context"
export function WorkspaceButton() {
  const workspace = useWorkspace()
  const { t } = useTranslation()
  if (workspace === null) return null
  const ToggleIcon = workspace.visible ? PanelRightIcon : PanelRightDashedIcon
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="workspace-sidebar-toggle"
      aria-label={t(workspace.visible ? "workspace.closeWorkspace" : "workspace.openWorkspace")}
      title={t(workspace.visible ? "workspace.closeWorkspace" : "workspace.openWorkspace")}
      aria-expanded={workspace.visible}
      aria-controls="file-workspace-panel"
      onClick={workspace.toggle}>
      <ToggleIcon className="size-4" />
    </Button>
  )
}
