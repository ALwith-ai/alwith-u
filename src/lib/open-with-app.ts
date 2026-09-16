// Opening a project folder in an installed app (ALwith Desktop's open-with-app + the chat
// header's OpenInEditorButton). Candidates are English bundle names; Rust answers with the
// localized display name, the bundle id (Windows: exe path) and the icon.
import { invoke } from "@tauri-apps/api/core"
import { isMac } from "@/lib/platform"

export type AppInfo = { name: string; bundle_id: string; icon: string | null }

/** macOS: `.app` names resolved from the application folders; Windows: uninstall-table names. */
export function externalAppCandidates(): string[] {
  return isMac()
    ? [
        "Finder",
        "Terminal",
        "iTerm",
        "Ghostty",
        "Warp",
        "Visual Studio Code",
        "Cursor",
        "Zed",
        "PyCharm",
        "RustRover",
        "WebStorm",
        "IntelliJ IDEA",
        "Xcode",
        "Android Studio",
        "cmux"
      ]
    : ["File Explorer", "Windows Terminal", "Visual Studio Code", "Cursor", "Zed", "PyCharm", "RustRover", "WebStorm"]
}

export function readAppsInfo(names: string[], withIcons: boolean): Promise<AppInfo[]> {
  return invoke<AppInfo[]>("read_apps_info", { names, withIcons })
}

export function openPathInApp(bundleId: string, path: string): Promise<void> {
  return invoke("open_path_in_app", { bundleId, path })
}
