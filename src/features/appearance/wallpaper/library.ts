import { convertFileSrc } from "@tauri-apps/api/core"
import { commands } from "@/bindings"
import type { ImportedWallpaper } from "./types"

export const wallpaperLibrary = {
  list: (): Promise<ImportedWallpaper[]> => commands.wallpaperList(),
  import: (locale: string): Promise<ImportedWallpaper | null> => commands.wallpaperImport({ locale }),
  remove: (id: string, locale: string): Promise<boolean> => commands.wallpaperRemove({ id, locale }),
  imageUrl(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
      throw new Error("Invalid wallpaper identity")
    return convertFileSrc(id, "wallpaper")
  }
}
