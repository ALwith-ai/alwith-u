import { appendComposerDraft, updateDraftAttachments } from "@alwith/module-chat/conversation"
import { DetachedPaneGrip, useDesktopCanvas } from "@alwith/module-desktop-shell/react"
import { DevicePanel } from "@alwith/module-device/preview"
import { deviceBridge, openCaptureWindow } from "@alwith/module-device/tauri"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { emitTo } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import { platform } from "@tauri-apps/plugin-os"
import { MoreHorizontalIcon, SmartphoneIcon } from "lucide-react"
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

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
import { PreviewPaneContext } from "@/features/workspace/preview-pane-context"

import { devicePresentation } from "./presentation"
import { deviceSelections } from "./window-routing"

/** Keep device controls behind a compact workspace overflow menu. */
export function DeviceWorkspaceMenu({ children }: { children?: ReactNode }) {
  const workspace = useWorkspace()
  const canvas = useDesktopCanvas()
  const { t } = useTranslation()
  if (workspace?.openPane === undefined || !isTauri()) return null
  const openPane = workspace.openPane
  const active =
    workspace.visible &&
    workspace.pane === "simulator" &&
    (!canvas || canvas.region === "chat" || canvas.region === "preview")
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
          {children}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The simulator pane. The shared panel owns its chrome and strings; the host binds the session. */
export function DeviceWorkspacePane({
  sessionId,
  detached = false,
  initialDeviceId,
  maximized,
  onMaximize,
  onClose
}: {
  sessionId: string
  detached?: boolean
  initialDeviceId?: string
  maximized: boolean
  onMaximize: () => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const preview = useContext(PreviewPaneContext)
  const selectedDevice = useRef(initialDeviceId ?? deviceSelections.get(sessionId))
  const selectionChanged = useCallback(
    (id: string | undefined) => {
      if (!id) return
      selectedDevice.current = id
      deviceSelections.set(sessionId, id)
      if (detached)
        void invoke("device_window_selection", { deviceId: id }).catch((error: unknown) => toast.error(String(error)))
    },
    [sessionId, detached]
  )
  const [moving, setMoving] = useState(false)
  const [generation, setGeneration] = useState(0)
  const controls = useContext(PanelControlsContext)
  const presentation = useMemo(
    () =>
      devicePresentation({
        ...deviceBridge(sessionId),
        openCapture: (capture: Parameters<typeof openCaptureWindow>[1]) =>
          openCaptureWindow(sessionId, capture, "/capture.html"),
        copyText: writeText,
        revealCapture: (path: string) => revealItemsInDir([path])
      }),
    [sessionId, generation]
  )
  const move = useCallback(
    async (atCursor = false) => {
      if (moving) return
      setMoving(true)
      try {
        await presentation.release()
        if (detached) await getCurrentWindow().destroy()
        else {
          await invoke("device_window_open", { sessionId, atCursor, deviceId: selectedDevice.current ?? null })
          onClose()
        }
      } catch (error) {
        setGeneration((value) => value + 1)
        setMoving(false)
        toast.error(String(error))
      }
    },
    [moving, presentation, detached, sessionId, onClose]
  )
  useEffect(() => {
    if (detached) {
      const stop = getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault()
        void move()
      })
      return () => {
        void stop.then((dispose) => dispose())
      }
    }
    return preview?.registerDetach?.(() => {
      void move(true)
    })
  }, [detached, move, preview])
  if (moving) return null
  return (
    <div data-device-workspace className="h-full min-h-0">
      <DevicePanel
        key={sessionId}
        bridge={presentation.bridge}
        initialDeviceId={selectedDevice.current}
        onDeviceChange={selectionChanged}
        windowGrip={
          detached ? (
            <DetachedPaneGrip
              label={t("device.panel.dock")}
              onDrop={() => {
                void invoke<boolean>("device_window_over_main")
                  .then((inside) => {
                    if (inside) void move()
                  })
                  .catch((error: unknown) => toast.error(String(error)))
              }}
            />
          ) : undefined
        }
        windowAction={{
          label: t(detached ? "device.panel.dock" : "device.panel.detach"),
          onSelect: () => {
            void move()
          }
        }}
        onAddContext={async (text) => {
          if (detached) await emitTo("main", "device-window-context", { sessionId, text })
          else appendComposerDraft(sessionId, text)
        }}
        onAddCapture={async (capture, url) => {
          if (detached) {
            await emitTo("main", "device-window-context", {
              sessionId,
              text: `Device capture: ${capture.name}\n${capture.path}`,
              capture,
              url
            })
            return
          }
          appendComposerDraft(sessionId, `Device capture: ${capture.name}\n${capture.path}`)
          if (capture.kind === "image")
            updateDraftAttachments(sessionId, (attachments) => [
              ...attachments,
              { id: crypto.randomUUID(), type: "file", mediaType: "image/png", filename: capture.name, url }
            ])
        }}
        platform={platform() === "windows" ? "android" : "ios"}
        language={i18n.language}
        agentName="U"
        maximized={controls?.expanded ?? maximized}
        onMaximize={controls?.toggleExpanded ?? onMaximize}
        onClose={
          detached
            ? () => {
                void move()
              }
            : onClose
        }
      />
    </div>
  )
}
