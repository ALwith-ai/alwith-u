export interface WallpaperPresentation {
  url: string
  fit: "cover" | "contain"
  brightness: number
  blur: number
}
export interface ImportedWallpaper {
  id: string
  name: string
  width: number
  height: number
}
