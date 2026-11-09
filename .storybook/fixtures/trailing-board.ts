import type { AppInfo } from "../../src/bindings"

export interface TrailingScenario {
  apps: AppInfo[]
  windows: string[]
  browserConnected?: boolean
}
let scenario: TrailingScenario | null = null
export function setTrailingScenario(value: TrailingScenario | null): void { scenario = value }
export function trailingRequest(command: string, args: Record<string, unknown>): { value: unknown } | null {
  if (!scenario) return null
  const labels = ["main", ...scenario.windows]
  const titles: Record<string, string> = { settings: "设置", chat: "聊天浮窗", guide: "用户指南", gamepad: "ALwith Gamepad" }
  if (command === "default_browser") return { value: scenario.apps.find((app) => /chrome|safari/i.test(app.bundle_id))?.name ?? "" }
  if (command === "read_apps_info") return { value: scenario.apps.filter((app) => (args.names as string[]).includes(app.name)) }
  if (command === "is_app_running") return { value: scenario.apps.some((app) => app.bundle_id === args.bundleId) }
  if (command === "plugin:window|get_all_windows") return { value: labels }
  if (command === "plugin:webview|get_all_webviews") return { value: labels.map((label) => ({ label, windowLabel: label })) }
  if (command === "plugin:window|is_visible") return { value: labels.includes(String(args.label)) }
  if (command === "plugin:window|title") return { value: titles[String(args.label)] ?? "ALwith U" }
  if (command === "plugin:window|close") { scenario.windows = scenario.windows.filter((label) => label !== args.label); return { value: null } }
  if (command === "chrome_extension_installed") return { value: scenario.browserConnected ?? false }
  if (command === "chrome_bridge_installed") return { value: scenario.browserConnected ?? false }
  // Scope the ping response to this isolated bridge scenario and resource ID.
  if (command === "plugin:http|fetch" && (args.clientConfig as { url?: string })?.url === "http://localhost:12306/ping") return { value: 67001 }
  if (command === "plugin:http|fetch_send" && args.rid === 67001) return { value: { status: scenario.browserConnected ? 204 : 503, statusText: scenario.browserConnected ? "No Content" : "Service Unavailable", url: "http://localhost:12306/ping", headers: [], rid: 67001 } }
  if ((command === "plugin:http|fetch_cancel" || command === "plugin:http|fetch_cancel_body") && args.rid === 67001) return { value: null }
  return null
}
