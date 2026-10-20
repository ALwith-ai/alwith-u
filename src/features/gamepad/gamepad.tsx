import { type GamepadHost, GamepadPanel, GamepadProvider } from "@alwith/module-gamepad/react"
import { createTauriGamepadTransport } from "@alwith/module-gamepad/tauri"
import "@alwith/module-gamepad/styles.css"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { platform } from "@tauri-apps/plugin-os"
import type { ReactNode } from "react"
import { toast } from "sonner"

import { generateGamepadConfig } from "./ai-host"

const gamepadWindow = getCurrentWebviewWindow()

const transport = createTauriGamepadTransport({
  invoke: (request) => invoke("gamepad_request", { request }),
  listen: (handler) =>
    gamepadWindow.listen("gamepad:event", (event) => handler(event.payload as Parameters<typeof handler>[0]))
})

function reportError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

// Serialize capture transitions so a fast close cannot overtake native startup.
let captureTransition = Promise.resolve()
function capture(start: boolean): Promise<void> {
  const operation = captureTransition.then(() => invoke<void>("gamepad_capture", { start }))
  captureTransition = operation.catch(reportError)
  return operation
}

const os = platform()
if (os !== "macos" && os !== "windows" && os !== "linux") {
  throw new Error(`Unsupported Gamepad platform: ${os}`)
}
const host: GamepadHost = {
  platform: os,
  request: transport.request,
  listen: transport.subscribe,
  permissions: {
    status: () => invoke("gamepad_permission", { operation: "status" }),
    request: () => invoke("gamepad_permission", { operation: "request" }),
    openSettings: async () => {
      await invoke("gamepad_permission", { operation: "settings" })
    }
  },
  openBluetoothSettings: async () => {
    await invoke("gamepad_permission", { operation: "bluetooth" })
  },
  capture: {
    start: () => capture(true),
    stop: () => capture(false),
    listen: (handler) =>
      gamepadWindow.listen("gamepad:capture-key", (event) => handler(event.payload as Parameters<typeof handler>[0]))
  },
  applications: {
    list: () => invoke("gamepad_catalog", { operation: "applications", path: null }),
    launchable: () => invoke("gamepad_catalog", { operation: "launchable", path: null }),
    icon: (path) => invoke("gamepad_catalog", { operation: "icon", path }),
    subscribe: (handler) =>
      gamepadWindow.listen("gamepad:applications-updated", (event) =>
        handler(event.payload as Parameters<typeof handler>[0])
      ),
    subscribeLaunchable: (handler) =>
      gamepadWindow.listen("gamepad:launchable-apps-updated", (event) =>
        handler(event.payload as Parameters<typeof handler>[0])
      )
  },
  microphones: () => invoke("gamepad_catalog", { operation: "microphones", path: null }),
  generateConfig: generateGamepadConfig,
  onError: reportError
}

export function GamepadSettings(): ReactNode {
  return (
    <GamepadProvider host={host}>
      <GamepadPanel />
    </GamepadProvider>
  )
}
