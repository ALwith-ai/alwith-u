// On-demand windows, reduced from ALwith Desktop's window-manager to the one this app has.
import { invoke } from "@tauri-apps/api/core"
import { emitTo } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import i18n from "@/lib/i18n"
import { isMac } from "@/lib/platform"

export type SettingsSection = "general" | "appearance" | "account" | "provider" | "about"
export const SETTINGS_SECTIONS: SettingsSection[] = ["general", "appearance", "account", "provider", "about"]
export const SETTINGS_CHANGE_TAB = "settings-change-tab"

const IS_WINDOWS = /Win/.test(navigator.platform)

/** The current theme's --background as [r, g, b] for the native window ground, so the
 *  new window never flashes white before its first frame (Desktop's themeBackgroundRGB). */
function themeBackgroundRGB(): [number, number, number] {
  const css = getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
  const el = document.createElement("canvas")
  el.width = el.height = 1
  const ctx = el.getContext("2d", { colorSpace: "srgb" })
  if (!ctx || !css) throw new Error("cannot read --background for the window ground")
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/**
 * Settings window: 720×800, fixed size, solid ground (Desktop keeps tool windows opaque).
 * Existing → shown and focused (its close is intercepted into hide); otherwise created.
 * On macOS it is attached as a child of the main window, so it floats over it and never
 * becomes its own Stage Manager stage.
 */
export async function openSettingsWindow(section?: SettingsSection): Promise<void> {
  const existing = await WebviewWindow.getByLabel("settings")
  if (existing) {
    if (isMac()) await invoke("attach_window_to_main", { label: "settings" })
    else {
      await existing.show()
      await existing.setFocus()
    }
    if (section !== undefined) await emitTo("settings", SETTINGS_CHANGE_TAB, section)
    return
  }
  const attachToMain = isMac()
  const win = new WebviewWindow("settings", {
    url: `/settings.html?tab=${section ?? "general"}`,
    title: i18n.t("settings.title"),
    width: 720,
    height: 800,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreen: false,
    hiddenTitle: true,
    titleBarStyle: "overlay",
    ...(IS_WINDOWS ? { decorations: false } : {}),
    backgroundColor: themeBackgroundRGB(),
    // Shown by the native attach (child windows must not pop up as stages first).
    ...(attachToMain ? { visible: false } : {})
  })
  void win.once("tauri://created", async () => {
    if (attachToMain) await invoke("attach_window_to_main", { label: "settings" })
    else {
      await win.show()
      await win.setFocus()
    }
  })
}
