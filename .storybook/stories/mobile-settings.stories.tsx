import type { Meta, StoryObj } from "@storybook/react-vite"
import { mockIPC } from "@tauri-apps/api/mocks"
import "../../src/features/settings/settings.css"

import { MobileSection } from "../../src/features/mobile/mobile-section"
import { type SettingsRequest, settingsStore } from "../../src/lib/settings-store"

const meta = {
  title: "Settings/Mobile connections",
  component: MobileSection,
  globals: { locale: "zh-CN" },
  beforeEach: () => {
    let revision = Date.now()
    let values: Record<string, unknown> = {
      "appearance.theme": settingsStore.get("appearance.theme"),
      "mobile.bridgeEnabled": true
    }
    let devices = [
      {
        deviceId: "preview-phone-12345678",
        publicKeyB64: "preview",
        name: "My iPhone",
        model: "iPhone 17 Pro",
        pairedAt: 1793000000000,
        pushHandle: null
      }
    ]
    settingsStore.accept({ revision: ++revision, values, browserMigrated: true })
    mockIPC((command, payload) => {
      if (command === "plugin:log|log" || command === "plugin:event|unlisten") return
      if (command === "plugin:event|listen") return 1
      if (command === "mobile_bridge_status") return { running: true, connected: true, relayConnected: true }
      if (command === "bridge_trusted_list") return devices
      if (command === "bridge_trusted_revoke") {
        devices = []
        return
      }
      if (command === "bridge_pairing_start")
        return {
          deviceId: "preview-u",
          publicKeyB64: "preview",
          code: "123456",
          hostApp: "u",
          expiresAt: Date.now() + 300000
        }
      if (command === "mobile_bridge_start" || command === "mobile_bridge_stop") return
      if (command === "settings_request") {
        const input = (payload as { input: SettingsRequest }).input
        values = { ...values, ...input.changes }
        return { revision: ++revision, values, browserMigrated: true }
      }
      throw new Error(`Unexpected mobile preview IPC command: ${command}`)
    })
    return () => {
      mockIPC((command) => {
        if (command === "plugin:log|log" || command === "plugin:event|unlisten") return
        throw new Error(`Unexpected Storybook IPC command: ${command}`)
      })
    }
  }
} satisfies Meta<typeof MobileSection>
export default meta
type Story = StoryObj<typeof meta>
export const Paired: Story = {}
