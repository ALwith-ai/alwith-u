import { getCurrentWindow } from "@tauri-apps/api/window"

import { DeviceWorkspacePane } from "@/features/device/device-workspace"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

const sessionId = new URLSearchParams(location.search).get("session")
if (!sessionId) throw new Error("Device window requires an explicit session")
function DeviceWindow() {
  return (
    <div className="h-dvh">
      <DeviceWorkspacePane
        sessionId={sessionId!}
        detached
        initialDeviceId={new URLSearchParams(location.search).get("device") ?? undefined}
        maximized={false}
        onMaximize={() => {
          void getCurrentWindow().toggleMaximize()
        }}
        onClose={() => {
          void getCurrentWindow().close()
        }}
      />
    </div>
  )
}
bootstrapAuxWindow({ component: DeviceWindow, logTag: "device-window", toaster: true })
