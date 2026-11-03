// Opening a project folder in an installed app (ALwith Desktop's open-with-app + the chat
// header's OpenInEditorButton). Candidates are English bundle names; the installed-apps plugin answers with the
// localized display name, the bundle id (Windows: exe path) and the icon.

import { type AppInfo_Serialize as AppInfo, commands } from "@alwith/module-installed-apps/commands"

import { isMac } from "@/lib/platform"

export type { AppInfo }

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
  return commands.readAppsInfo({ names, withIcons })
}

export async function openPathInApp(bundleId: string, path: string): Promise<void> {
  await commands.openPathInApp({ bundleId, path })
}
