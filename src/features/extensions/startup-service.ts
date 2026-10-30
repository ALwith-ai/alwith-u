import type { ExtensionRuntime } from "@alwith/module-extension/host"

/** Probe native ownership before start(), which retires the runtime on failure. */
export function createExtensionStartup(
  getRuntime: () => ExtensionRuntime,
  prepare: (runtime: ExtensionRuntime) => Promise<void>
): () => Promise<ExtensionRuntime> {
  let startup: Promise<ExtensionRuntime> | undefined
  return () => {
    if (startup) return startup
    const current = getRuntime()
    startup = (async () => {
      await current.refresh()
      await current.start()
      await prepare(current)
      return current
    })().catch((error: unknown) => {
      startup = undefined
      throw error
    })
    return startup
  }
}
