import type { ExtensionRuntime } from "@alwith/module-extension/host"
import { expect, test, vi } from "vitest"

import { createExtensionStartup } from "../startup-service"

test("a locked native service does not retire startup and can recover on retry", async () => {
  const refresh = vi.fn().mockRejectedValueOnce(new Error("root locked")).mockResolvedValue(undefined)
  const start = vi.fn().mockResolvedValue(undefined)
  const prepare = vi.fn().mockResolvedValue(undefined)
  const runtime = { refresh, start } as unknown as ExtensionRuntime
  const initialize = createExtensionStartup(() => runtime, prepare)
  const failed = initialize()
  expect(initialize()).toBe(failed)
  await expect(failed).rejects.toThrow("root locked")
  expect(start).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
  await expect(initialize()).resolves.toBe(runtime)
  await expect(initialize()).resolves.toBe(runtime)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(start).toHaveBeenCalledTimes(1)
  expect(prepare).toHaveBeenCalledTimes(1)
})
