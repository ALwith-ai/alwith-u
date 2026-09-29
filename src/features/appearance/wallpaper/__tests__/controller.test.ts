import { expect, test } from "bun:test"
import { WallpaperController } from "../controller"

test("revoking the owner clears its wallpaper and rejects late updates", (): void => {
  const controller = new WallpaperController()
  const session = controller.bind()
  session.show({ url: "extension://test/image.jpg", fit: "cover", brightness: 80, blur: 3 })
  expect(controller.snapshot()?.brightness).toBe(80)
  session.dispose()
  expect(controller.snapshot()).toBeNull()
  expect(() => session.show({ url: "extension://test/image.jpg", fit: "cover", brightness: 80, blur: 3 })).toThrow()
})

test("old owner cleanup does not clear a replacement wallpaper", (): void => {
  const controller = new WallpaperController()
  const first = controller.bind(),
    second = controller.bind()
  first.show({ url: "extension://first/a.jpg", fit: "cover", brightness: 100, blur: 0 })
  second.show({ url: "extension://second/b.jpg", fit: "contain", brightness: 90, blur: 2 })
  first.dispose()
  expect(controller.snapshot()?.url).toBe("extension://second/b.jpg")
  second.dispose()
})
