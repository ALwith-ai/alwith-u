import { parseManifest } from "@alwith/module-extension"
import { ResourceScope } from "@alwith/module-extension/host"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { expect, test } from "vitest"
import { wallpaperController } from "@/features/appearance/wallpaper/controller"
import { initI18n } from "@/lib/i18n"
import { createWallpaperCapability } from "../capabilities/wallpaper"

const manifest = parseManifest({
  id: "wallpaper-client",
  name: "Test extension",
  version: "1.0.0",
  dependencies: { "@alwith/module-extension": "^0.1.0" }
})

test("wallpaper dialogs receive the current app language through the native boundary", async (): Promise<void> => {
  const calls: { command: string; args: unknown }[] = []
  mockIPC((command, args) => {
    calls.push({ command, args })
    return command === "wallpaper_remove" ? false : null
  })
  const scope = new ResourceScope()
  const provider = createWallpaperCapability(error => {
    throw error
  })
  if (!provider.create) throw new Error("Expected a scoped provider")
  const capability = provider.create({ manifest, cancellation: scope.cancellation, own: dispose => scope.own(dispose) })
  try {
    await initI18n("zh-CN")
    expect(await capability.removeImage("test-image")).toBe(false)
    await initI18n("en")
    expect(await capability.importImage()).toBeNull()
    expect(calls).toEqual([
      { command: "wallpaper_remove", args: { id: "test-image", locale: "zh-CN" } },
      { command: "wallpaper_import", args: { locale: "en" } }
    ])
  } finally {
    clearMocks()
    await scope.dispose()
  }
})

test("adapter accepts any authorized binding and releases presentation on cancellation", async (): Promise<void> => {
  const scope = new ResourceScope()
  const provider = createWallpaperCapability(error => {
    throw error
  })
  if (!provider.create) throw new Error("Expected a scoped provider")
  const capability = provider.create({
    manifest: { ...manifest, id: "another-wallpaper-client" },
    cancellation: scope.cancellation,
    own: dispose => scope.own(dispose)
  })
  try {
    capability.show({ url: "extension://token/assets/test.jpg", fit: "cover", brightness: 100, blur: 0 })
    expect(wallpaperController.snapshot()?.url).toBe("extension://token/assets/test.jpg")
    await scope.dispose()
    expect(wallpaperController.snapshot()).toBeNull()
    expect(() => capability.show(null)).toThrow()
  } finally {
    await scope.dispose()
  }
})
