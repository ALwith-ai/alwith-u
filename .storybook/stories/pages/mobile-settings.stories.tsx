import { mockIPC } from "@tauri-apps/api/mocks"
import type { ComponentProps } from "react"

import { handleNativeRequest } from "../../fixtures/native"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import "../../../src/features/settings/settings.css"

import { MobileSection } from "../../../src/features/mobile/mobile-section"
import { type SettingsRequest, settingsStore } from "../../../src/lib/settings-store"

export const pageMeta = {
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
    mockIPC(
      (command, payload) => {
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
        return handleNativeRequest(command, payload)
      },
      { shouldMockEvents: true }
    )
    return () => {
      mockIPC(
        (command, payload) => {
          if (command === "plugin:log|log" || command === "plugin:event|unlisten") return
          return handleNativeRequest(command, payload)
        },
        { shouldMockEvents: true }
      )
    }
  }
} satisfies SharedMeta<ComponentProps<typeof MobileSection>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "页面/设置页/手机连接",
  excludeStories: ["pageMeta"],
  component: MobileSection,
  ...pageMeta
})
export const Paired = meta.story({ name: "已配对设备" })
