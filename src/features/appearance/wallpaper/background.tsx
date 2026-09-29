import { useSyncExternalStore, type ReactElement, type ReactNode } from "react"
import { wallpaperController } from "./controller"

export function WallpaperBackground({
  children,
  onError
}: {
  children: ReactNode
  onError(error: Error): void
}): ReactElement {
  const value = useSyncExternalStore(wallpaperController.subscribe, wallpaperController.snapshot)
  return (
    <div className="wallpaper-shell" data-wallpaper={value ? "active" : undefined}>
      {value && (
        <img
          key={value.url}
          className="wallpaper-background"
          src={value.url}
          alt=""
          aria-hidden="true"
          style={{ objectFit: value.fit, filter: `brightness(${value.brightness / 100}) blur(${value.blur}px)` }}
          onError={() => onError(new Error("Wallpaper image could not be loaded / 壁纸图片加载失败"))}
        />
      )}
      {children}
    </div>
  )
}
