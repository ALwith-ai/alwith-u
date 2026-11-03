import {
  createDriveController,
  type DriveController,
  type DriveRequest,
  type DriveResponse,
  type DriveTransport
} from "@alwith/module-drive"
import { createTauriDriveTransport } from "@alwith/module-drive/tauri"
import { emitTo } from "@tauri-apps/api/event"
import i18n from "i18next"
import { toast } from "sonner"

const transport = createTauriDriveTransport()
export const driveTransport: DriveTransport = {
  ...transport,
  async request(request) {
    const response = await transport.request(request)
    if (["login", "ssoLogin", "logout", "start", "setPreferences"].includes(request.type)) {
      await emitTo("main", "drive:policy-changed", null)
    }
    return response
  }
}
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
