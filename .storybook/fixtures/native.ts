import type { NativeRequest } from "@alwith/module-fs/tauri"
import { emit } from "@tauri-apps/api/event"
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks"

import { version } from "../../package.json"
import type { ComputerStatus, Snapshot as ProviderSnapshot } from "../../src/bindings"
import type { SettingsRequest } from "../../src/lib/settings-store"
import { PROJECT_DIRECTORY, QUICK_DIRECTORY } from "./catalog"
import { consumeTextAttachmentFault } from "./composer"
import { extensionRequest } from "./extensions"
import { fileRequest, virtualFiles } from "./filesystem"
import { gamepadRequest, resetGamepad } from "./gamepad"
import { resetUpdater, restartPreview } from "./updater"
import { resetVoice, type VoiceCase, voiceRequest } from "./voice"

export let providers: ProviderSnapshot = {
  revision: 1,
  appliedRevision: 1,
  providers: {},
  customProviders: [],
  status: "applied",
  error: null
}
export let computerStatus: ComputerStatus = {
  available: true,
  enabled: false,
  version: "storybook",
  permissions: { supported: true, accessibility: true, screenCapture: true }
}
export type ProviderCase =
  | "ready"
  | "custom"
  | "pending"
  | "error"
  | "saving"
  | "testing"
  | "invalidKey"
  | "timeout"
  | "network"
  | "unsupported"
  | "rateLimited"
let providerMode: ProviderCase = "ready"
let revision = 100
let values: Record<string, unknown> = {}
export const nativeCalls: { command: string; payload: unknown }[] = []
export function navigatePreview(page: string, section?: string): void {
  window.dispatchEvent(new CustomEvent("storybook:navigate", { detail: { page, section } }))
}
export function resetNative(kind: ProviderCase = "ready", voice: VoiceCase = "disabled"): void {
  providerMode = kind
  resetVoice(voice)
  resetUpdater()
  resetGamepad()
  nativeCalls.length = 0
  providers = { revision: 1, appliedRevision: 1, providers: {}, customProviders: [], status: "applied", error: null }
  if (kind !== "ready") providers.providers = { deepseek: { configured: true, region: null, base_url: null } }
  if (kind === "custom")
    providers.customProviders = [
      {
        id: "custom_demo",
        name: "团队模型网关",
        baseUrl: "https://models.example.test/v1",
        models: [
          { label: "交付助手", api_id: "delivery-model", contextWindow: 128000 },
          { label: "代码助手", api_id: "code-model" }
        ]
      }
    ]
  if (kind === "pending") providers.status = "pending"
  if (kind === "error") providers.error = "模型配置应用失败，请重试。"
  values = {
    "chat.navigationSoundMode": "none",
    "general.language": "zh-CN",
    "voice.enabled": voice !== "disabled",
    "voice.inputMode": voice === "noSpeech" ? "send" : "dictation",
    "appearance.sidebarPinned": true
  }
  computerStatus = {
    available: true,
    enabled: false,
    version: "storybook",
    permissions: { supported: true, accessibility: true, screenCapture: true }
  }
}
export function setComputerStatus(patch: Partial<ComputerStatus>): void {
  computerStatus = { ...computerStatus, ...patch }
}

export function installNativeMock(os: "macos" | "windows" | "linux" = "macos"): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: os === "macos" ? "MacIntel" : os === "windows" ? "Win32" : "Linux x86_64"
  })
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { platform: os === "macos" ? "macOS" : os === "windows" ? "Windows" : "Linux" }
  })
  mockWindows("main", "settings", "gamepad", "guide", "chat")
  Object.assign(window, {
    isTauri: true,
    __TAURI__: {},
    __TAURI_OS_PLUGIN_INTERNALS__: {
      platform: os,
      arch: "aarch64",
      family: os === "windows" ? "windows" : "unix",
      version: "15.0",
      type: os,
      eol: "\n"
    }
  })
  mockIPC(
    (command, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>
      nativeCalls.push({ command, payload })
      if (command === "plugin:log|log" || command === "plugin:app|set_app_theme") return
      if (command === "plugin:app|version") return version
      if (command === "plugin:window|get_all_windows") return ["main", "settings", "gamepad", "guide", "chat"]
      if (command === "plugin:webview|get_all_webviews")
        return ["main", "settings", "gamepad", "guide", "chat"].map((label) => ({ label, windowLabel: label }))
      if (command === "plugin:window|show" || command === "plugin:window|set_focus") {
        if (args.label !== "main") navigatePreview(String(args.label))
        return
      }
      if (command.startsWith("plugin:window|is_"))
        return command.endsWith("is_visible") || command.endsWith("is_focused")
      if (command === "plugin:window|scale_factor") return 1
      if (command === "plugin:window|inner_size" || command === "plugin:window|outer_size")
        return { width: window.innerWidth, height: window.innerHeight }
      if (command === "plugin:window|outer_position" || command === "plugin:window|inner_position")
        return { x: 0, y: 0 }
      if (
        /^plugin:window\|(hide|close|unminimize|set_size|set_position|start_dragging|set_always_on_top|set_ignore_cursor_events|set_shadow|set_background_color|set_content_protected|set_min_size|set_max_size)$/.test(
          command
        )
      )
        return
      if (command === "chat_write_text_attachment") {
        const fault = consumeTextAttachmentFault()
        if (fault === "pending") return new Promise(() => {})
        if (fault === "error") throw new Error("模拟文本附件写入失败")
        const path = `${PROJECT_DIRECTORY}/attachments/pasted-text.txt`
        virtualFiles.set(path, new TextEncoder().encode(String(args.text)))
        return path
      }
      if (command === "chat_read_dropped_file") {
        const path = String(args.path)
        const bytes = virtualFiles.get(path)
        if (!bytes) throw new Error("模拟拖入文件读取失败")
        return {
          path,
          name: path.split("/").at(-1),
          image: path.endsWith(".svg")
            ? { data: btoa(new TextDecoder().decode(bytes)), mimeType: "image/svg+xml" }
            : null
        }
      }
      if (command === "chat_preview_file") {
        const path = String(args.path)
        const bytes = virtualFiles.get(path)
        if (!bytes) throw new Error(`File not found: ${path}`)
        if (path.endsWith(".svg"))
          return { kind: "image", data: btoa(new TextDecoder().decode(bytes)), mimeType: "image/svg+xml" }
        return { kind: "text", text: new TextDecoder().decode(bytes) }
      }
      if (command === "draft_directory") return args.cwd ?? QUICK_DIRECTORY
      if (command === "workspace_open") return args.path ?? PROJECT_DIRECTORY
      if (command === "workspace_file") return fileRequest(args.request as NativeRequest)
      if (command === "show_main_window") {
        navigatePreview("chat")
        return
      }
      if (command === "workspace_move_to") {
        const sources = args.sources as string[]
        const destination = String(args.destination)
        const moves = sources.map((from) => ({ from, to: `${destination}/${from.split("/").at(-1)}` }))
        for (const move of moves)
          fileRequest({ operation: "move", root: String(args.root), path: move.from, to: move.to })
        return { moves, cloud: false, error: null }
      }
      if (
        command === "workspace_watch" ||
        command === "attach_window_to_main" ||
        command === "workspace_dirty" ||
        command === "set_traffic_light_zoom" ||
        command === "plugin:webview|set_webview_zoom"
      )
        return
      if (command === "read_apps_info")
        return [
          {
            name: "Visual Studio Code",
            bundle_id: "com.microsoft.VSCode",
            path: "/Applications/Visual Studio Code.app",
            icon: null
          }
        ]
      if (command === "settings_request") {
        const input = args.input as SettingsRequest
        values = { ...values, ...input.changes }
        return { revision: ++revision, values, browserMigrated: true }
      }
      if (command === "providers_read" || command === "providers_apply") return providers
      if (command === "providers_save_custom" || command === "providers_remove_custom") {
        if (providerMode === "saving") return new Promise(() => {})
        const input = args.input as ProviderSnapshot["customProviders"][number]
        providers = {
          ...providers,
          revision: providers.revision + 1,
          appliedRevision: providers.revision + 1,
          customProviders:
            command === "providers_remove_custom"
              ? providers.customProviders.filter((p) => p.id !== args.providerId)
              : [...providers.customProviders.filter((p) => p.id !== input.id), input]
        }
        void emit("providers:changed", providers)
        return providers
      }
      if (command === "providers_save") {
        if (providerMode === "saving") return new Promise(() => {})
        const id = String(args.providerId)
        const keys = { ...providers.providers }
        if (args.input) keys[id] = { configured: true, region: null, base_url: null }
        else delete keys[id]
        providers = {
          ...providers,
          providers: keys,
          revision: providers.revision + 1,
          appliedRevision: providers.revision + 1
        }
        void emit("providers:changed", providers)
        return providers
      }
      if (command === "providers_test") {
        if (providerMode === "testing") return new Promise(() => {})
        const code = (
          {
            invalidKey: "unauthorized",
            timeout: "timeout",
            network: "network",
            unsupported: "invalid_response",
            rateLimited: "rate_limited"
          } as Record<string, string>
        )[providerMode]
        return code
          ? {
              ok: false,
              code,
              message: "模拟连接测试失败",
              status: providerMode === "invalidKey" ? 401 : providerMode === "rateLimited" ? 429 : null,
              latencyMs: null
            }
          : { ok: true, code: "ok", message: "", latencyMs: 128, status: 200 }
      }
      if (command === "computer_subscribe" || command === "computer_unsubscribe") return
      if (command === "plugin:deep-link|get_current") return null
      if (command === "computer_status") return computerStatus
      if (command === "computer_start") {
        computerStatus = { ...computerStatus, enabled: true }
        return computerStatus
      }
      if (command === "computer_stop") {
        computerStatus = { ...computerStatus, enabled: false }
        return computerStatus
      }
      if (command === "computer_stop_session" || command === "computer_request_permissions") return
      if (command.startsWith("voice_")) return voiceRequest(command, args)
      if (command === "autostart_status") return { enabled: false, supported: true }
      if (command === "autostart_set") return { enabled: args.enabled, supported: true }
      if (command === "plugin:dialog|open") return PROJECT_DIRECTORY
      if (command === "plugin:dialog|ask" || command === "plugin:dialog|confirm") return true
      if (
        command === "plugin:clipboard-manager|write_text" ||
        command === "plugin:opener|reveal_item_in_dir" ||
        command === "plugin:opener|open_path" ||
        command === "plugin:opener|open_url"
      )
        return
      if (command === "plugin:path|resolve_directory") return "/Users/demo/Library/Application Support/ALwith U"
      if (command === "plugin:path|join") return (args.paths as string[]).join("/")
      if (command === "updater_get_state") return { type: "idle" }
      if (command === "updater_install_and_relaunch") {
        restartPreview()
        return
      }
      if (command === "extension_prepare_install")
        return {
          format: "current",
          path: "/demo/extensions/delivery-helper",
          id: "delivery-helper",
          version: "1.0.0",
          digest: "storybook-delivery-1"
        }
      if (command === "extension_cleanup_grants") return
      if (command === "plugin:extension|dispatch")
        return extensionRequest(args.request as Parameters<typeof extensionRequest>[0])
      if (command === "gamepad_permission") return { supported: true, authorized: true, mayPrompt: false, known: true }
      if (command === "gamepad_capture") return
      if (command === "gamepad_catalog") return []
      if (command === "gamepad_request") {
        return gamepadRequest(args.request as Parameters<typeof gamepadRequest>[0])
      }
      throw new Error(`Unimplemented Storybook host boundary: ${command}`)
    },
    { shouldMockEvents: true }
  )
}

installNativeMock()
