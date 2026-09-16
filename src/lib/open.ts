import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

export function openExternal(url: string): Promise<void> {
  return openUrl(url)
}

export function openFile(path: string): Promise<void> {
  return openPath(path)
}

export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path)
}
