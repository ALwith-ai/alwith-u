import type { ClientOptions } from "@alwith/module-chat/client"
import { isTauri } from "@tauri-apps/api/core"

import { deviceSessionContext } from "@/features/device/session-context"
import { driveSessionContext } from "@/features/drive/session-context"
import { browserSessionContext } from "@/features/web-automation/session-context"

export const hostSessionContext: NonNullable<ClientOptions["sessionContext"]> = async (cwd) => {
  const drive = await driveSessionContext(cwd)
  if (!isTauri()) return drive
  const device = await deviceSessionContext()
  const browser = await browserSessionContext()
  const appendSystemPrompt = [
    "The desktop application is ALwith U. For questions about this app's features, setup or troubleshooting, use ALwith Docs when available and base answers on documentation for the installed ALwith U version.",
    drive.appendSystemPrompt,
    "Use the computer_* application tools only when the task requires interacting with the local desktop. Enabling access grants permission across conversations. Do not enumerate apps or windows, check availability, or capture the screen during ordinary tasks. Use computer_get_app_state where available. Otherwise start with computer_list_windows and computer_get_window_state. Use the current target identity and its element indices, window tokens or screenshot coordinates. Prefer background input and computer_set_value when supported. Perform actions sequentially. Refresh after navigation, layout changes, dialogs or a tool error. Report access or permission refusals and gestures that require foreground input. The application restores its driver after a transport failure. Obtain fresh state before continuing and never repeat an action whose outcome is unknown.",
    device.appendSystemPrompt,
    browser.appendSystemPrompt
  ]
    .filter(Boolean)
    .join("\n\n")
  return {
    bind: browser.bind,
    mcpServers: [...drive.mcpServers, ...device.mcpServers, ...browser.mcpServers],
    appendSystemPrompt
  }
}
