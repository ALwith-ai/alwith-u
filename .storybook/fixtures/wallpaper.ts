// Adapt only native resource URLs; validation, ownership and subscription use the source controller.
import { WallpaperController, wallpaperController as source } from "../../src/features/appearance/wallpaper/controller"
import type { WallpaperPresentation } from "../../src/features/appearance/wallpaper/types"
export { WallpaperController }
let previous: WallpaperPresentation | null = null
let translated: WallpaperPresentation | null = null
export const wallpaperController = {
  bind: () => source.bind(),
  subscribe: source.subscribe,
  snapshot() {
    const value = source.snapshot()
    if (value !== previous) {
      previous = value
      translated = value && {
        ...value,
        url:
          value.url === "wallpaper:storybook-missing"
            ? "/storybook-fixtures/missing.svg"
            : "/storybook-fixtures/wallpaper.svg"
      }
    }
    return translated
  }
}
