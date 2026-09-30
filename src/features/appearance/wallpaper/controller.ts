import type { WallpaperPresentation } from "./types"

export class WallpaperController {
  private current: WallpaperPresentation | null = null
  private owner: object | null = null
  private listeners = new Set<() => void>()
  snapshot = (): WallpaperPresentation | null => this.current
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(value: WallpaperPresentation | null): void {
    this.current = value
    for (const listener of this.listeners) listener()
  }
  bind(): { show(value: WallpaperPresentation | null): void; dispose(): void } {
    let active = true
    const owner = {}
    const dispose = (): void => {
      active = false
      if (this.owner === owner) {
        this.owner = null
        this.publish(null)
      }
    }
    return {
      dispose,
      show: value => {
        if (!active) throw new Error("Wallpaper presentation has been released")
        if (
          value &&
          (!Number.isFinite(value.brightness) ||
            value.brightness < 30 ||
            value.brightness > 120 ||
            !Number.isFinite(value.blur) ||
            value.blur < 0 ||
            value.blur > 24 ||
            !["cover", "contain"].includes(value.fit))
        )
          throw new Error("Invalid wallpaper presentation")
        if (
          value &&
          !/^(extension:|https?:\/\/extension\.localhost\/|wallpaper:|https?:\/\/wallpaper\.localhost\/)/.test(
            value.url
          )
        )
          throw new Error("Wallpaper must be a local extension resource")
        this.owner = owner
        this.publish(value === null ? null : { ...value })
      }
    }
  }
}
export const wallpaperController = new WallpaperController()
