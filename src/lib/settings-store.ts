import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export interface SettingsSnapshot {
  revision: number
  values: Record<string, unknown>
  browserMigrated: boolean
}
export interface SettingsRequest {
  action: "read" | "update" | "importBrowser" | "saveVoice"
  changes?: Record<string, unknown>
  expectedRevision?: number
  apiKey?: string | null
}
type Request = (input: SettingsRequest) => Promise<SettingsSnapshot>
type Listener = (keys: string[]) => void

/** A webview projection. Rust remains the only writer and source of truth. */
export class SettingsClient {
  private snapshot: SettingsSnapshot = { revision: -1, values: {}, browserMigrated: false }
  private readonly listeners = new Set<Listener>()
  private readonly request: Request
  constructor(request: Request) {
    this.request = request
  }
  accept(next: SettingsSnapshot): void {
    if (next.revision <= this.snapshot.revision) return
    const previous = this.snapshot.values
    this.snapshot = next
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next.values)])].filter(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(next.values[key])
    )
    if (keys.length) for (const listener of this.listeners) listener(keys)
  }
  get<T>(key: string): T | undefined {
    return this.snapshot.values[key] as T | undefined
  }
  async read(): Promise<SettingsSnapshot> {
    this.accept(await this.request({ action: "read" }))
    return this.snapshot
  }
  async write(input: SettingsRequest): Promise<SettingsSnapshot> {
    const saved = await this.request(input)
    this.accept(saved)
    return saved
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
export const settingsStore = new SettingsClient((input) => invoke("settings_request", { input }))
let initialization: Promise<void> | undefined

function initializeSettings(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    await listen<SettingsSnapshot>("settings:changed", (event) => settingsStore.accept(event.payload))
    const snapshot = await settingsStore.read()
    if (!snapshot.browserMigrated) {
      const changes: Record<string, unknown> = {}
      const theme = localStorage.getItem("theme")
      if (theme !== null) changes["appearance.theme"] = theme
      const editor = localStorage.getItem("workspace:editor-settings")
      if (editor !== null) {
        const value: unknown = JSON.parse(editor)
        if (typeof value !== "object" || value === null || Array.isArray(value))
          throw new Error("Invalid legacy editor settings")
        for (const [key, entry] of Object.entries(value)) changes[`editor.${key}`] = entry
      }
      const iconTheme = localStorage.getItem("workspace:editor-icon-theme")
      if (iconTheme !== null) changes["editor.iconTheme"] = JSON.parse(iconTheme)
      await settingsStore.write({ action: "importBrowser", changes })
    }
    applyInitialTheme()
  })()
  return initialization
}
function applyInitialTheme(): void {
  const theme = settingsStore.get<string>("appearance.theme") ?? "system"
  const resolved =
    theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme
  document.documentElement.classList.toggle("dark", resolved === "dark")
  document.documentElement.classList.toggle("light", resolved === "light")
  document.documentElement.style.colorScheme = resolved
}
/** Browser previews have no native persistence; production bootstrap always initializes Rust. */
export async function bootstrapSettings(): Promise<void> {
  try {
    if (isTauri()) await initializeSettings()
    else applyInitialTheme()
  } catch (error: unknown) {
    const root = document.getElementById("root")
    if (root) root.textContent = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    document.documentElement.style.visibility = "visible"
  }
}
export async function updateSettings(changes: Record<string, unknown>): Promise<void> {
  await settingsStore.write({ action: "update", changes })
}
