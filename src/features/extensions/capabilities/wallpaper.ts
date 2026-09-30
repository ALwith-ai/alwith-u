import type { CapabilityProvider } from "@alwith/module-extension/host"
import { wallpaperController } from "@/features/appearance/wallpaper/controller"
import { wallpaperLibrary } from "@/features/appearance/wallpaper/library"
import i18n from "@/lib/i18n"
import type { WallpaperCapability } from "./wallpaper-contract"

export function createWallpaperCapability(
  reportError: (error: unknown) => void
): CapabilityProvider<WallpaperCapability> {
  return {
    version: "1.0.0",
    create(binding) {
      const { cancellation } = binding
      cancellation.throwIfAborted()
      const presentation = wallpaperController.bind()
      binding.own(presentation.dispose)
      binding.own(cancellation.subscribe(presentation.dispose))
      const request = async <T>(operation: () => Promise<T>): Promise<T> => {
        cancellation.throwIfAborted()
        const result = await operation()
        cancellation.throwIfAborted()
        return result
      }
      const language = (): string => i18n.resolvedLanguage ?? i18n.language
      return {
        show: value => {
          cancellation.throwIfAborted()
          presentation.show(value)
        },
        language,
        subscribeLanguage(listener) {
          cancellation.throwIfAborted()
          i18n.on("languageChanged", listener)
          return binding.own(() => {
            i18n.off("languageChanged", listener)
          })
        },
        listImages: () => request(wallpaperLibrary.list),
        importImage: () => request(() => wallpaperLibrary.import(language())),
        removeImage: id => request(() => wallpaperLibrary.remove(id, language())),
        imageUrl(id) {
          cancellation.throwIfAborted()
          return wallpaperLibrary.imageUrl(id)
        },
        reportError
      }
    }
  }
}
