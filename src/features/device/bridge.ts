import type { AttachmentInfo, DeviceBridge, DeviceGesture } from "@alwith/module-device/preview"
import { isTauri } from "@tauri-apps/api/core"

import { commands, events } from "@/bindings"

/** One bridge per conversation: the panel attaches on behalf of that conversation's agent session. */
export function deviceBridge(sessionId: string): DeviceBridge {
  return {
    listDevices: (platform) => commands.deviceList({ platform }),
    attach: (udid, platform) => commands.deviceAttach({ sessionId, platform, udid: udid ?? null }),
    detach: async (udid) => {
      await commands.deviceDetach({ udid })
    },
    captureFrame: (udid) => commands.deviceFrame({ udid }),
    gesture: async (udid, gesture: DeviceGesture) => {
      await commands.deviceGesture({ udid, gesture })
    },
    appearance: (udid) => commands.deviceAppearance({ udid }),
    setAppearance: async (udid, mode) => {
      await commands.deviceSetAppearance({ udid, mode })
    },
    setStatusBar: async (udid, look) => {
      await commands.deviceSetStatusBar({ udid, look })
    },
    shutdown: async (udid) => {
      await commands.deviceShutdown({ udid })
    },
    restart: async (udid) => {
      await commands.deviceRestart({ udid })
    },
    readLogs: (udid, query) =>
      commands.deviceLogs({
        udid,
        query: {
          sinceSeq: query.sinceSeq ?? null,
          tail: query.tail ?? null,
          minLevel: query.minLevel ?? null,
          filter: query.filter ?? null
        }
      }),
    saveScreenshot: (udid) => commands.deviceSaveScreenshot({ udid }),
    subscribe: (listener: (attachments: AttachmentInfo[]) => void) => {
      if (!isTauri()) return () => {}
      let disposed = false
      let unlisten: (() => void) | undefined
      const own = (attachments: AttachmentInfo[]) =>
        attachments.filter((entry) => entry.owner.type === "development_session" && entry.owner.id === sessionId)
      void commands
        .deviceAttachments()
        .then((attachments) => {
          if (!disposed) listener(own(attachments))
        })
        .catch(() => undefined)
      void events["device:attachments"]
        .listen(({ payload }) => {
          if (!disposed) listener(own(payload.attachments))
        })
        .then((stop) => {
          if (disposed) stop()
          else unlisten = stop
        })
      return () => {
        disposed = true
        unlisten?.()
      }
    }
  }
}
