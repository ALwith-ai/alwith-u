export interface WallpaperPresentation {
  url: string
  fit: "cover" | "contain"
  brightness: number
  blur: number
}
export type { ImportedImage as ImportedWallpaper } from "@/bindings"
