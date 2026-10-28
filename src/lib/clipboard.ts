import { isTauri } from "@tauri-apps/api/core"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"

/** Use the native clipboard in every desktop window, including Markdown actions. */
export function copyText(text: string): Promise<void> {
  return isTauri() ? writeText(text) : navigator.clipboard.writeText(text)
}
