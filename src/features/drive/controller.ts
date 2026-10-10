import { createDriveController, type DriveEvent, type DriveResponse } from "@alwith/module-drive"
import { createTauriDriveTransport } from "@alwith/module-drive/tauri"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"

export const driveTransport = createTauriDriveTransport({
  invoke: async request => {
    const response = await invoke<DriveResponse>("drive_request", { request })
    if (["login", "ssoLogin", "logout", "start", "setPreferences"].includes(request.type)) {
      await emitTo("main", "drive:policy-changed", null)
    }
    return response
  },
  listen: handler => listen<DriveEvent>("drive:event", event => handler(event.payload))
})
export const drive = createDriveController(driveTransport)
