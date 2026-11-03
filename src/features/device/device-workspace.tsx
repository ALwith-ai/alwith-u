import { DevicePanel } from "@alwith/module-device/preview"
import { deviceBridge } from "@alwith/module-device/tauri"
import { isTauri } from "@tauri-apps/api/core"
import { MoreHorizontalIcon, SmartphoneIcon } from "lucide-react"
import { useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/features/workspace/context"
import { PanelControlsContext } from "@/features/workspace/panel-controls-context"

/** Keep device controls behind a compact workspace overflow menu. */
export function DeviceWorkspaceMenu() {
  const workspace = useWorkspace()
  const { t } = useTranslation()
  if (workspace?.openPane === undefined || !isTauri()) return null
  const openPane = workspace.openPane
  const active = workspace.visible && workspace.pane === "simulator"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="workspace-sidebar-toggle"
            aria-label={t("actions.more")}
            data-workspace-overflow
          />
        }
      >
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => openPane("simulator")}>
            <SmartphoneIcon />
            {t(active ? "device.panel.close" : "device.panel.open")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The simulator pane. The shared panel owns its chrome and strings; the host binds the session. */
export function DeviceWorkspacePane({
  sessionId,
  maximized,
  onMaximize,
  onClose
}: {
  sessionId: string
  maximized: boolean
  onMaximize: () => void
  onClose: () => void
}) {
  const { i18n } = useTranslation()
  const controls = useContext(PanelControlsContext)
  const bridge = useMemo(() => deviceBridge(sessionId), [sessionId])
  return (
    <div data-device-workspace className="h-full min-h-0">
      <DevicePanel
        bridge={bridge}
        platform="ios"
        language={i18n.language}
        agentName="U"
        maximized={controls?.expanded ?? maximized}
        onMaximize={controls?.toggleExpanded ?? onMaximize}
        onClose={onClose}
      />
    </div>
  )
}
