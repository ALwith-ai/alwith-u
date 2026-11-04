import {
  createDriveController,
  type DriveController,
  type DriveRequest,
  type DriveResponse
} from "@alwith/module-drive"
import { createTauriDriveTransport } from "@alwith/module-drive/tauri"
import { emitTo } from "@tauri-apps/api/event"
import i18n from "i18next"
import { toast } from "sonner"

const nativeTransport = createTauriDriveTransport()
export const driveTransport = {
  ...nativeTransport,
  async request(request: DriveRequest): Promise<DriveResponse> {
    const response = await nativeTransport.request(request).catch((error: unknown) => {
      // Plugin rejections carry coded objects; UI consumers require readable Error messages.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        "message" in error &&
        typeof error.message === "string"
      )
        throw new Error(error.message, { cause: error })
      throw error
    })
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
