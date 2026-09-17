import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

export function openExternal(url: string): Promise<void> {
  return openUrl(url)
}

export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path)
}
