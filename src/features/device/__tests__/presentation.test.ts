import type { DeviceBridge } from "@alwith/module-device/preview"
import { expect, test, vi } from "vitest"

import { devicePresentation } from "../presentation"

test("moving waits for a pending native mount, removes it once, and never disconnects the device", async () => {
  let mounted!: (id: string) => void
  let removed!: () => void
  const detach = vi.fn()
  const unmount = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        removed = resolve
      })
  )
  const bridge = {
    detach,
    nativeView: {
      mount: () =>
        new Promise<string>((resolve) => {
          mounted = resolve
        }),
      unmount
    }
  } as unknown as DeviceBridge
  const presentation = devicePresentation(bridge)
  const pending = presentation.bridge.nativeView!.mount("device", {} as never)
  let finished = false
  const moving = presentation.release().then(() => {
    finished = true
  })
  mounted("view")
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledWith("view"))
  expect(finished).toBe(false)
  const cleanup = presentation.bridge.nativeView!.unmount("view")
  removed()
  await Promise.all([pending, moving, cleanup])
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(detach).not.toHaveBeenCalled()
  await expect(presentation.bridge.nativeView!.mount("device", {} as never)).rejects.toThrow("moving")
})

test("failed native removal prevents the destination from starting", async () => {
  const presentation = devicePresentation({
    nativeView: {
      mount: async () => "view",
      unmount: async () => {
        throw Error("remove failed")
      }
    }
  } as unknown as DeviceBridge)
  await presentation.bridge.nativeView!.mount("device", {} as never)
  await expect(presentation.release()).rejects.toThrow("remove failed")
})
