import type { ExtensionRuntime } from "@alwith/module-extension/host"
import type { InstallResult } from "./install-service"
import type { UninstallFailures } from "./uninstall-failures"
import { waitForLegacyUninstall } from "./legacy/uninstall"

type UninstallRuntime = Pick<ExtensionRuntime, "snapshot" | "subscribe" | "request" | "settled">

/** Native completion performs any requested purge only after all windows release the package. */
export async function executeUninstall(
  runtime: UninstallRuntime,
  id: string,
  failures?: UninstallFailures
): Promise<InstallResult> {
  const snapshot = runtime.snapshot().native
  if (!snapshot) throw new Error("Extension service is not ready")
  const existing = snapshot.installations.find(item => item.id === id)
  const pending = snapshot.pending.find(item => item.id === id)
  const initialError = runtime.snapshot().errors[id]
  if (pending && pending.action !== "uninstall") throw new Error("Extension is transitioning")
  if (existing && !pending) await runtime.request({ type: "beginTransition", id, action: "uninstall" })
  await waitForLegacyUninstall({
    state: () => {
      const state = runtime.snapshot()
      const native = state.native
      if (!native) throw new Error("Extension service became unavailable")
      const remoteError = failures?.error(id)
      if (remoteError) throw new Error(`Extension failed to release its instance: ${remoteError}`)
      const waiting = native.pending.some(item => item.id === id)
      if (waiting && state.errors[id] && (pending || state.errors[id] !== initialError))
        throw new Error(`Extension failed to release its instance: ${state.errors[id]}`)
      return {
        installed: native.installations.some(item => item.id === id),
        pending: waiting
      }
    },
    subscribe: listener => {
      const stopRuntime = runtime.subscribe(listener)
      const stopFailures = failures?.subscribe(listener)
      return () => {
        stopRuntime()
        stopFailures?.()
      }
    },
    cleanup: async () => {}
  })
  await runtime.settled()
  const actual = runtime.snapshot().native
  if (!actual || actual.installations.some(item => item.id === id) || actual.pending.some(item => item.id === id))
    throw new Error("Extension state changed before uninstall completed")
  return {
    id,
    version: existing?.manifest.version ?? "",
    packageRevision: existing?.packageRevision ?? "",
    installed: false,
    enabled: false,
    activeInMainWindow: false,
    error: null
  }
}
