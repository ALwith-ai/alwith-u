import type { ComponentProps } from "react"

import { handleNativeRequest, mockHost } from "../../fixtures/native"
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
    mockHost((command, payload) => {
      if (command === "plugin:alwith-mobile|mobile_bridge_status")
        return { running: true, connected: true, relayConnected: true }
      if (command === "plugin:alwith-mobile|bridge_trusted_list") return devices
      if (command === "plugin:alwith-mobile|bridge_trusted_revoke") {
        devices = []
        return null
      }
      if (command === "plugin:alwith-mobile|bridge_pairing_start")
        return {
          deviceId: "preview-u",
          publicKeyB64: "preview",
          code: "123456",
          hostApp: "u",
          expiresAt: Date.now() + 300000
        }
      if (
        command === "plugin:alwith-mobile|mobile_bridge_start" ||
        command === "plugin:alwith-mobile|mobile_bridge_stop"
      )
        return null
      if (command === "settings_request") {
        const input = (payload as { input: SettingsRequest }).input
        values = { ...values, ...input.changes }
        return { revision: ++revision, values, browserMigrated: true }
      }
      return handleNativeRequest(command, payload)
    })
    return () => mockHost()
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
