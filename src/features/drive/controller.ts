import {
  createDriveController,
  type DriveController,
  type DriveEvent,
  type DriveRequest,
  type DriveResponse
} from "@alwith/module-drive"
import { createTauriDriveTransport } from "@alwith/module-drive/tauri"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import i18n from "i18next"
import { toast } from "sonner"

export const driveTransport = createTauriDriveTransport({
  invoke: async (request) => {
    const response = await invoke<DriveResponse>("drive_request", { request })
    if (["login", "ssoLogin", "logout", "start", "setPreferences"].includes(request.type)) {
      await emitTo("main", "drive:policy-changed", null)
    }
    return response
  },
  listen: (handler) => listen<DriveEvent>("drive:event", (event) => handler(event.payload))
})
const controller = createDriveController(driveTransport)
export const drive: DriveController = {
  ...controller,
  async request(request: DriveRequest): Promise<DriveResponse> {
    const response = await controller.request(request)
    if (["reconfigure", "setPreferences", "setMaxAutoDownloadMb"].includes(request.type)) {
      toast.success(i18n.language?.startsWith("zh") ? "云盘配置已保存" : "Drive settings saved", {
        id: "drive-settings-saved"
      })
    }
    return response
  }
}
