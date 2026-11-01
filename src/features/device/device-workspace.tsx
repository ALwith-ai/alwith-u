import { DevicePanel } from "@alwith/module-device/preview"
import { isTauri } from "@tauri-apps/api/core"
import { SmartphoneIcon } from "lucide-react"
import { useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/features/workspace/context"
import { PanelControlsContext } from "@/features/workspace/panel-controls-context"

import { deviceBridge } from "./bridge"

/** Opens the simulator in the preview region, as a pane beside the file workspace. */
export function DeviceWorkspaceButton() {
  const workspace = useWorkspace()
  const { t } = useTranslation()
  if (workspace === null || workspace.openPane === undefined || !isTauri()) return null
  const openPane = workspace.openPane
  const active = workspace.visible && workspace.pane === "simulator"
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="workspace-sidebar-toggle"
      aria-label={t(active ? "device.panel.close" : "device.panel.open")}
      title={t(active ? "device.panel.close" : "device.panel.open")}
      aria-pressed={active}
      onClick={() => openPane("simulator")}
    >
      <SmartphoneIcon className="size-4" />
    </Button>
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
