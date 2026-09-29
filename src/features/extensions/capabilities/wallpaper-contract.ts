import { capability, type Dispose } from "@alwith/module-extension"
import type { ImportedWallpaper, WallpaperPresentation } from "@/features/appearance/wallpaper/types"

export interface WallpaperCapability {
  show(value: WallpaperPresentation | null): void
  language(): string
  subscribeLanguage(listener: () => void): Dispose
  listImages(): Promise<ImportedWallpaper[]>
  importImage(): Promise<ImportedWallpaper | null>
  imageUrl(id: string): string
  removeImage(id: string): Promise<boolean>
  reportError(error: unknown): void
}
export const wallpaperCapability = capability<WallpaperCapability>("alwith.u.wallpaper")
