import { createInstalledApplications } from "@alwith/module-gamepad/installed-apps"
import { GamepadPanel, GamepadProvider } from "@alwith/module-gamepad/react"
import { createTauriGamepadHost } from "@alwith/module-gamepad/tauri"
import "@alwith/module-gamepad/styles.css"
import { nativeErrorMessage } from "@alwith/module-gamepad/commands"
import { platform } from "@tauri-apps/plugin-os"
import type { ReactNode } from "react"
import { toast } from "sonner"

import { generateGamepadConfig } from "./ai-host"

function reportError(error: unknown): void {
  toast.error(nativeErrorMessage(error))
}

const os = platform()
if (os !== "macos" && os !== "windows" && os !== "linux") {
  throw new Error(`Unsupported Gamepad platform: ${os}`)
}
const host = createTauriGamepadHost({
  platform: os,
  onError: reportError,
  applications: createInstalledApplications(reportError),
  generateConfig: generateGamepadConfig
})
export function GamepadSettings(): ReactNode {
  return (
    <GamepadProvider host={host}>
      <GamepadPanel />
    </GamepadProvider>
  )
}
