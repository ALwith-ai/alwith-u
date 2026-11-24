import type {
  CustomInput_Deserialize as CustomProviderInput,
  Snapshot_Serialize as ProviderSnapshot,
  TestResult_Serialize as ProviderTestResult
} from "@alwith/module-chat/commands"
import type { ComputerStatus_Serialize as ComputerStatus } from "@alwith/module-computer/commands"
import type { InvokeArgs } from "@tauri-apps/api/core"
import { emit } from "@tauri-apps/api/event"
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks"

import { version } from "../../package.json"
import type { SettingsRequest } from "../../src/lib/settings-store"
import { PROJECT_DIRECTORY, QUICK_DIRECTORY } from "./catalog"
import { consumeTextAttachmentFault } from "./composer"
import { extensionRequest } from "./extensions"
import { applyPatches, fileRequest, type NativeRequest, pathExists, virtualFiles } from "./filesystem"
import { gamepadCommand } from "./gamepad"
import { resetSpreadsheets, spreadsheetCommand } from "./spreadsheet"
import { setTrailingScenario, trailingRequest } from "./trailing-board"
import { resetUpdater, restartPreview, updaterState } from "./updater"
import { pushAudio, resetVoice, type VoiceCase, voiceRequest } from "./voice"

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
  phase: "ready",
  driverPhase: "stopped",
  connections: { ready: 0, connecting: 0, disconnected: 0, failed: 0 },
  lastError: null,
  diagnostics: "",
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
let revision = Date.now()
let values: Record<string, unknown> = {}
let autostart = false
export const nativeCalls: { command: string; payload: unknown }[] = []
export function navigatePreview(page: string, section?: string): void {
  window.dispatchEvent(new CustomEvent("storybook:navigate", { detail: { page, section } }))
}
export function resetNative(
  kind: ProviderCase = "ready",
  voice: VoiceCase = "disabled",
  theme: "light" | "dark" = "light"
): void {
  providerMode = kind
  resetVoice(voice)
  resetUpdater()
  resetSpreadsheets()
  setTrailingScenario(null)
  nativeCalls.length = 0
  fileTokens.clear()
  autostart = false
  providers = { revision: 1, appliedRevision: 1, providers: {}, customProviders: [], status: "applied", error: null }
  if (kind !== "ready") providers.providers = { deepseek: { configured: true, region: null, baseUrl: null } }
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
    "appearance.theme": theme,
    "appearance.sidebarPinned": true
  }
  computerStatus = {
    available: true,
    enabled: false,
    version: "storybook",
    phase: "ready",
    driverPhase: "stopped",
    connections: { ready: 0, connecting: 0, disconnected: 0, failed: 0 },
    lastError: null,
    diagnostics: "",
    permissions: { supported: true, accessibility: true, screenCapture: true }
  }
}
export function setComputerStatus(patch: Partial<ComputerStatus>): void {
  computerStatus = { ...computerStatus, ...patch }
}

const fileTokens = new Map<string, { root: string; path: string }>()
/** The file a `workspace_create_url` address names, while its token is live. */
function addressedFile(address: string): { root: string; path: string } | undefined {
  const url = new URL(address, location.href)
  if (url.origin !== "http://alwith-file.localhost") throw new Error(`Not a workspace file address: ${address}`)
  return fileTokens.get(decodeURIComponent(url.pathname.split("/")[1]))
}
function readAddress(address: string): Uint8Array {
  const file = addressedFile(address)
  if (!file) throw new Error(`Unknown or revoked file token: ${address}`)
  return new Uint8Array(fileRequest({ operation: "readFile", ...file }) as number[])
}
const browserFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.origin !== "http://alwith-file.localhost") return browserFetch(input, init)
  const file = addressedFile(url.href)
  if (!file) return new Response("Unknown or revoked file token", { status: 404 })
  return new Response(new Uint8Array(fileRequest({ operation: "readFile", ...file }) as number[]))
}, globalThis.fetch)

type InvokeOptions = { headers?: Record<string, string> }
function header(command: string, options: InvokeOptions | undefined, name: string): string {
  const value = options === undefined || options.headers === undefined ? undefined : options.headers[name]
  if (value === undefined) throw new Error(`${command} must send the ${name} header`)
  return value
}
// Commands whose request body is raw bytes, with the rest of the request in headers.
const rawBodyCommands: Record<string, (body: Uint8Array, options: InvokeOptions | undefined) => unknown> = {
  "plugin:alwith-fs|workspace_write_file": (body, options) => {
    const command = "plugin:alwith-fs|workspace_write_file"
    const target = JSON.parse(decodeURIComponent(header(command, options, "options"))) as { root: string; path: string }
    nativeCalls.push({ command, payload: { ...target, size: body.length } })
    return fileRequest({ operation: "writeFile", root: target.root, path: target.path, data: [...body] }) ?? null
  },
  "plugin:alwith-voice|push": (body, options) => {
    const command = "plugin:alwith-voice|push"
    return pushAudio(
      header(command, options, "x-recording-id"),
      Number(header(command, options, "x-audio-sequence")),
      body
    )
  }
}
/**
 * Tauri's IPC mock answered by `handler`. Stories that answer a few commands themselves pass a handler
 * that ends in `handleNativeRequest`.
 */
export function mockHost(handler: (command: string, payload?: InvokeArgs) => unknown = handleNativeRequest): void {
  mockIPC(handler, { shouldMockEvents: true })
  // Tauri's mock drops request options before calling the handler, so the commands that carry their
  // target in headers are answered here, with the headers.
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, body?: unknown, options?: InvokeOptions) => Promise<unknown>
      }
    }
  ).__TAURI_INTERNALS__
  const invoke = internals.invoke
  internals.invoke = (command, body, options) => {
    const raw = rawBodyCommands[command]
    if (raw === undefined) return invoke(command, body, options)
    return Promise.try(() => {
      if (!(body instanceof Uint8Array)) throw new Error(`${command} must send its bytes as the request body`)
      return raw(body, options)
    })
  }
}

export function installNativeMock(os: "macos" | "windows" | "linux" = "macos"): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: os === "macos" ? "MacIntel" : os === "windows" ? "Win32" : "Linux x86_64"
  })
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: {
      platform: os === "macos" ? "macOS" : os === "windows" ? "Windows" : "Linux",
      mobile: false,
      brands: [{ brand: "Chromium", version: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "150" }]
    }
  })
  mockConvertFileSrc("windows")
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
  mockHost()
}

const fileOperations: Record<string, NativeRequest["operation"] | undefined> = {
  "plugin:alwith-fs|workspace_stat": "stat",
  "plugin:alwith-fs|workspace_read_directory": "readDirectory",
  "plugin:alwith-fs|workspace_create_directory": "createDirectory",
  "plugin:alwith-fs|workspace_remove": "remove",
  "plugin:alwith-fs|workspace_move": "move",
  "plugin:alwith-fs|workspace_copy": "copy"
}
// The host log is the console here; `@tauri-apps/plugin-log` numbers its levels from trace (1) to error (5).
const hostLog: Record<number, (message: string) => void> = {
  1: console.debug,
  2: console.debug,
  3: console.info,
  4: console.warn,
  5: console.error
}
// A dialog answered with its affirmative button, as `plugin-dialog` names the buttons it asks for.
function affirmativeButton(buttons: unknown): string {
  if (buttons === "Ok" || buttons === "OkCancel") return "Ok"
  if (buttons === "YesNo" || buttons === "YesNoCancel") return "Yes"
  if (typeof buttons === "object" && buttons !== null) {
    if ("OkCustom" in buttons) return String(buttons.OkCustom)
    if ("OkCancelCustom" in buttons) return (buttons.OkCancelCustom as [string, string])[0]
    if ("YesNoCancelCustom" in buttons) return (buttons.YesNoCancelCustom as [string, string, string])[0]
  }
  throw new Error(`Unknown dialog buttons: ${JSON.stringify(buttons)}`)
}
function saveProviders(next: Omit<ProviderSnapshot, "revision" | "appliedRevision" | "status" | "error">) {
  if (providerMode === "saving") return new Promise(() => {})
  providers = { ...providers, ...next, revision: providers.revision + 1, appliedRevision: providers.revision + 1 }
  void emit("providers:changed", providers)
  return providers
}
export function handleNativeRequest(command: string, payload?: unknown): unknown {
  const args = (payload ?? {}) as Record<string, unknown>
  nativeCalls.push({ command, payload })
  const trailing = trailingRequest(command, args)
  if (trailing) return trailing.value
  if (command === "plugin:log|log") {
    const log = hostLog[args.level as number]
    if (log === undefined) throw new Error(`Unknown log level: ${String(args.level)}`)
    log(`[host log] ${String(args.message)}`)
    return null
  }
  if (command === "plugin:app|set_app_theme") return null
  if (command === "plugin:app|version") return version
  if (command === "plugin:app|identifier") return "ai.alwith.u.storybook"
  if (command === "codex_version") return "0.167.0"
  if (command === "codex_status") return { version: "0.167.0", local: null }
  // No enterprise account is bound in the catalog: what the host answers before a binding.
  if (command === "enterprise_catalog") return null
  if (command === "enterprise_status")
    return {
      enabled: true,
      authorization_status: "unauthorized",
      automatic_renewal: false,
      requires_login: false,
      error: null
    }
  if (command === "plugin:window|get_all_windows") return ["main", "settings", "gamepad", "guide", "chat"]
  if (command === "plugin:webview|get_all_webviews")
    return ["main", "settings", "gamepad", "guide", "chat"].map((label) => ({ label, windowLabel: label }))
  if (command === "plugin:window|show" || command === "plugin:window|set_focus") {
    if (args.label !== "main") navigatePreview(String(args.label))
    return
  }
  if (command.startsWith("plugin:window|is_")) return command.endsWith("is_visible") || command.endsWith("is_focused")
  if (command === "plugin:window|scale_factor") return 1
  if (command === "set_chat_window_backdrop") return null
  if (command === "plugin:window|inner_size" || command === "plugin:window|outer_size")
    return { width: window.innerWidth, height: window.innerHeight }
  if (command === "plugin:window|outer_position" || command === "plugin:window|inner_position") return { x: 0, y: 0 }
  if (
    /^plugin:window\|(hide|close|unminimize|set_size|set_position|start_dragging|set_always_on_top|set_ignore_cursor_events|set_shadow|set_background_color|set_content_protected|set_min_size|set_max_size)$/.test(
      command
    )
  )
    return
  if (command === "plugin:alwith-chat|write_text_attachment") {
    const fault = consumeTextAttachmentFault()
    if (fault === "pending") return new Promise(() => {})
    if (fault === "error") throw new Error("模拟文本附件写入失败")
    const path = `${PROJECT_DIRECTORY}/attachments/pasted-text.txt`
    virtualFiles.set(path, new TextEncoder().encode(String(args.text)))
    return path
  }
  if (command === "plugin:alwith-chat|read_dropped_file") {
    const path = String(args.path)
    const bytes = virtualFiles.get(path)
    if (!bytes) throw new Error("模拟拖入文件读取失败")
    return {
      path,
      name: path.split("/").at(-1),
      image: path.endsWith(".svg") ? { data: btoa(new TextDecoder().decode(bytes)), mimeType: "image/svg+xml" } : null,
      directory: false
    }
  }
  if (command === "plugin:alwith-chat|clipboard_file_paths") return []
  if (command === "plugin:alwith-chat|write_pasted_file") {
    const name = String(args.name).split(/[\\/]/).at(-1)!
    const path = `${PROJECT_DIRECTORY}/attachments/${name}`
    virtualFiles.set(path, Uint8Array.from(args.data as number[]))
    return path
  }
  if (command === "plugin:alwith-chat|preview_file") {
    const path = String(args.path)
    const bytes = virtualFiles.get(path)
    if (!bytes) throw new Error(`File not found: ${path}`)
    if (path.endsWith(".svg"))
      return { kind: "image", data: btoa(new TextDecoder().decode(bytes)), mimeType: "image/svg+xml" }
    return { kind: "text", text: new TextDecoder().decode(bytes) }
  }
  if (command === "draft_directory") return args.cwd ?? QUICK_DIRECTORY
  if (command === "plugin:alwith-fs|workspace_open") {
    if (typeof args.path !== "string") throw new Error("workspace_open names the folder to open")
    return args.path
  }
  if (command === "plugin:alwith-fs|workspace_create_url") {
    const token = crypto.randomUUID()
    fileTokens.set(token, { root: String(args.root), path: String(args.path) })
    return token
  }
  if (command === "plugin:alwith-fs|workspace_revoke_url") {
    if (!fileTokens.delete(String(args.token))) throw new Error("Unknown file token")
    return null
  }
  // The file system module asks for each operation by a command of its own.
  const operation = fileOperations[command]
  if (operation) return fileRequest({ ...(args as Omit<NativeRequest, "operation">), operation }) ?? null
  if (command === "plugin:alwith-fs|workspace_apply_patches")
    return applyPatches(String(args.root), args.patches as Parameters<typeof applyPatches>[1], args.reverse as boolean)
  if (command === "plugin:alwith-fs|workspace_watch") return null
  if (command === "plugin:alwith-fs|capability_roots") return [PROJECT_DIRECTORY]
  if (command.startsWith("plugin:alwith-editor|spreadsheet_")) return spreadsheetCommand(command, args, readAddress)
  if (command === "show_main_window") {
    navigatePreview("chat")
    return null
  }
  if (command === "workspace_move_to") {
    const sources = args.sources as string[]
    const destination = String(args.destination)
    const moves = sources.map((from) => ({ from, to: `${destination}/${from.split("/").at(-1)}` }))
    for (const move of moves) fileRequest({ operation: "move", root: String(args.root), path: move.from, to: move.to })
    return { moves, cloud: false, error: null }
  }
  if (command === "attach_window_to_main") return true
  if (command === "drive_path_exists") return pathExists(String(args.path))
  if (
    command === "workspace_dirty" ||
    command === "plugin:alwith-desktop-shell|set_traffic_light_zoom" ||
    command === "plugin:webview|set_webview_zoom"
  )
    return null
  if (command === "plugin:alwith-installed-apps|read_apps_info")
    return [{ name: "Visual Studio Code", bundle_id: "com.microsoft.VSCode", icon: null }]
  if (command === "plugin:alwith-installed-apps|list_applications") return []
  if (command === "settings_request") {
    const input = args.input as SettingsRequest
    values = { ...values, ...input.changes }
    revision = Math.max(revision + 1, Date.now())
    return { revision, values, browserMigrated: true }
  }
  if (command === "plugin:alwith-chat|providers_read" || command === "plugin:alwith-chat|providers_apply")
    return providers
  if (command === "plugin:alwith-chat|providers_save_custom") {
    // The snapshot holds the provider's public settings; its key stays with the host.
    const input = args.input as CustomProviderInput
    const id = input.id ?? `custom_${crypto.randomUUID()}`
    return saveProviders({
      providers: providers.providers,
      customProviders: [
        ...providers.customProviders.filter((provider) => provider.id !== id),
        {
          id,
          name: input.name,
          baseUrl: input.baseUrl,
          // The host omits a model's unset context window and description.
          models: input.models.map(({ label, api_id, contextWindow, description }) => ({
            label,
            api_id,
            ...(contextWindow === null || contextWindow === undefined ? {} : { contextWindow }),
            ...(description === null || description === undefined ? {} : { description })
          }))
        }
      ]
    })
  }
  if (command === "plugin:alwith-chat|providers_remove_custom")
    return saveProviders({
      providers: providers.providers,
      customProviders: providers.customProviders.filter((provider) => provider.id !== args.providerId)
    })
  if (command === "plugin:alwith-chat|providers_save") {
    const id = String(args.providerId)
    const keys = { ...providers.providers }
    if (args.input) keys[id] = { configured: true, region: null, baseUrl: null }
    else delete keys[id]
    return saveProviders({ providers: keys, customProviders: providers.customProviders })
  }
  if (command === "plugin:alwith-chat|providers_test") {
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
    return (
      code
        ? {
            ok: false,
            code,
            message: "模拟连接测试失败",
            status: providerMode === "invalidKey" ? 401 : providerMode === "rateLimited" ? 429 : null,
            latencyMs: null
          }
        : { ok: true, code: "ok", message: "", latencyMs: 128, status: 200 }
    ) satisfies ProviderTestResult
  }
  if (command === "plugin:deep-link|get_current") return null
  // The phone bridge is off and no phone is paired; the phone connection page answers these itself.
  if (command === "plugin:alwith-mobile|mobile_bridge_status")
    return { running: false, connected: false, relayConnected: false }
  if (command === "plugin:alwith-mobile|bridge_trusted_list") return []
  if (command === "plugin:alwith-computer|status") return computerStatus
  if (command === "plugin:alwith-computer|start") {
    computerStatus = { ...computerStatus, enabled: true }
    return computerStatus
  }
  if (command === "plugin:alwith-computer|stop") {
    computerStatus = { ...computerStatus, enabled: false }
    return null
  }
  if (
    command === "plugin:alwith-computer|subscribe" ||
    command === "plugin:alwith-computer|unsubscribe" ||
    command === "plugin:alwith-computer|stop_session" ||
    command === "plugin:alwith-computer|request_permissions"
  )
    return null
  if (command.startsWith("plugin:alwith-voice|")) return voiceRequest(command, args)
  if (command.startsWith("plugin:alwith-gamepad|")) return gamepadCommand(command, args)
  // The catalog shows the application without an embedded browser, as the Wry backend runs it.
  if (command === "runtime_capabilities") return { backend: "wry", embeddedBrowser: false, canSwitchBackend: false }
  if (command === "autostart_status") return { enabled: autostart, supported: true }
  if (command === "autostart_set") {
    autostart = args.enabled as boolean
    return null
  }
  if (command === "plugin:dialog|open") return PROJECT_DIRECTORY
  if (command === "plugin:dialog|message") return affirmativeButton(args.buttons)
  if (command === "plugin:alwith-desktop-shell|confirm") return true
  if (
    command === "plugin:clipboard-manager|write_text" ||
    command === "plugin:opener|reveal_items_in_dir" ||
    command === "plugin:opener|open_path" ||
    command === "plugin:opener|open_url"
  )
    return null
  if (command === "plugin:path|resolve_directory") return "/Users/demo/Library/Application Support/ALwith U"
  if (command === "plugin:path|join") return (args.paths as string[]).join("/")
  if (
    command === "plugin:alwith-desktop-shell|updater_state" ||
    command === "plugin:alwith-desktop-shell|updater_check"
  )
    return updaterState
  if (command === "plugin:alwith-desktop-shell|updater_install_and_relaunch") {
    restartPreview()
    return null
  }
  if (command === "extension_prepare_install")
    return {
      format: "current",
      path: "/demo/extensions/delivery-helper",
      id: "delivery-helper",
      version: "1.0.0",
      digest: "storybook-delivery-1"
    }
  if (command === "extension_cleanup_grants" || command === "extension_inbox_finish") return null
  if (command === "extension_inbox_scan" || command === "extension_inbox_scan_extension")
    return { operationId: "storybook-inbox", tasks: [], errors: [] }
  if (command === "plugin:alwith-extension|dispatch")
    return extensionRequest(args.request as Parameters<typeof extensionRequest>[0])
  if (command === "plugin:alwith-terminal|request") {
    // Storybook has no terminals: nothing is running in any session, and nothing can be started here.
    const method = args.method
    if (method === "capabilities") return { version: 1, headless: false, interactiveView: false }
    if (method === "list") return []
    if (method === "snapshot") return null
    if (method === "listeningPorts")
      return (args.params as { sessionIds: string[] }).sessionIds.map((sessionId) => ({ sessionId, ports: [] }))
    throw new Error(`Unimplemented Storybook terminal request: ${String(method)}`)
  }
  throw new Error(`Unimplemented Storybook host boundary: ${command}`)
}

installNativeMock()
