// On-demand windows, reduced from ALwith Desktop's window-manager to the one this app has.

import { emitTo } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { platform } from "@tauri-apps/plugin-os"

import { commands } from "@/bindings"
import i18n from "@/lib/i18n"
import { isMac } from "@/lib/platform"

export type SettingsSection =
  | "trackpad"
  | "general"
  | "editor"
  | "appearance"
  | "account"
  | "provider"
  | "voice"
  | "computer"
  | "extensions"
  | "drive"
  | "about"
export const SETTINGS_SECTIONS: SettingsSection[] = [
  "account",
  "general",
  "provider",
  "appearance",
  "editor",
  "drive",
  "voice",
  "trackpad",
  "computer",
  "extensions",
  "about"
]
export const SETTINGS_CHANGE_TAB = "settings-change-tab"

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
 * Settings window: the right content keeps Desktop's 520px width while the navigation
 * sidebar grows to 240px, with a solid ground (Desktop keeps tool windows opaque).
 * Existing → shown and focused (its close is intercepted into hide); otherwise created.
 * On macOS it is attached as a child of the main window, so it floats over it and never
 * becomes its own Stage Manager stage.
 */
export async function openSettingsWindow(section?: SettingsSection): Promise<void> {
  const existing = await WebviewWindow.getByLabel("settings")
  if (existing) {
    // Attach re-parents a window that was detached; a hidden window still needs show and focus.
    if (isMac()) await commands.attachWindowToMain({ label: "settings" })
    await existing.show()
    await existing.setFocus()
    if (section !== undefined) await emitTo("settings", SETTINGS_CHANGE_TAB, section)
    return
  }
  const attachToMain = isMac()
  const win = new WebviewWindow("settings", {
    url: `/settings.html?tab=${section ?? "general"}`,
    title: i18n.t("settings.title"),
    width: 760,
    height: 800,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreen: false,
    hiddenTitle: true,
    titleBarStyle: "overlay",
    backgroundColor: themeBackgroundRGB(),
    // Shown by the native attach (child windows must not pop up as stages first).
    ...(attachToMain ? { visible: false } : {})
  })
  void win.once(
    "tauri://created",
    () =>
      void (async () => {
        if (attachToMain) await commands.attachWindowToMain({ label: "settings" })
        else {
          await win.show()
          await win.setFocus()
        }
      })()
  )
}

// Gamepad retains Desktop's independent, full-width tool window.
let openingGamepad: Promise<void> | null = null
export function openGamepadWindow(): Promise<void> {
  openingGamepad ??= createGamepadWindow().finally(() => {
    openingGamepad = null
  })
  return openingGamepad
}
async function createGamepadWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("gamepad")
  if (existing) {
    await existing.show()
    await existing.setFocus()
    return
  }
  const win = new WebviewWindow("gamepad", {
    url: "/gamepad.html",
    title: "ALwith Gamepad",
    ...(platform() === "windows" ? { decorations: false } : {}),
    width: 1250,
    height: 800,
    minWidth: 1250,
    minHeight: 750,
    minimizable: false,
    transparent: false,
    hiddenTitle: true,
    titleBarStyle: "overlay",
    backgroundColor: themeBackgroundRGB()
  })
  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve()).catch(reject)
    void win.once("tauri://error", (event) => reject(new Error(String(event.payload)))).catch(reject)
  })
}
