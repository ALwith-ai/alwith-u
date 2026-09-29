import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import type { ImportedWallpaper } from "./types"

export const wallpaperLibrary = {
  list: (): Promise<ImportedWallpaper[]> => invoke("wallpaper_list"),
  import: (locale: string): Promise<ImportedWallpaper | null> => invoke("wallpaper_import", { locale }),
  remove: (id: string, locale: string): Promise<boolean> => invoke("wallpaper_remove", { id, locale }),
  imageUrl(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
      throw new Error("Invalid wallpaper identity")
    return convertFileSrc(id, "wallpaper")
  }
}
