import type { ExtensionRuntime } from "@alwith/module-extension/host"
import { convertLegacyExtension, type PreparedLegacyImport } from "./legacy/import"
import { LEGACY_SOURCE } from "./legacy/profiles"

export type PreparedInstall =
  | { format: "current"; path: string; id: string; version: string; digest: string }
  | { format: "legacy"; prepared: PreparedLegacyImport }

interface InstallOptions {
  update: boolean
  /** Omitted preserves the UI's existing behavior: enable new legacy imports only. */
  enable?: boolean
}

export interface InstallResult {
  id: string
  version: string
  packageRevision: string
  installed: boolean
  enabled: boolean
  activeInMainWindow: boolean
  error: { code: string; message: string } | null
}

interface InstallPort {
  stageLegacy(
    ticket: string,
    converted: Awaited<ReturnType<typeof convertLegacyExtension>>
  ): Promise<{
    path: string
    id: string
    version: string
    source: string
    digest: string
  }>
}

type InstallRuntime = Pick<ExtensionRuntime, "snapshot" | "subscribe" | "request" | "settled"> & {
  host: Pick<ExtensionRuntime["host"], "snapshot">
}

/** Folder-picker and startup imports share the same commit and activation checks. */
export async function executePreparedInstall(
  runtime: InstallRuntime,
  selected: PreparedInstall,
  options: InstallOptions,
  port?: InstallPort
): Promise<InstallResult> {
  const id =
    selected.format === "current" ? selected.id : String((await convertLegacyExtension(selected.prepared)).manifest.id)
  const source = selected.format === "current" ? "local" : LEGACY_SOURCE
  const native = runtime.snapshot().native
  if (!native) throw new Error("Extension service is not ready")
  const existing = native.installations.find(item => item.id === id)
  if (native.pending.some(item => item.id === id)) throw new Error("Extension is transitioning")
  if (existing && !options.update) throw new Error("Extension is already installed; choose update")
  if (existing && existing.source !== source) throw new Error("Extension belongs to a different installation source")
  const staged =
    selected.format === "current"
      ? { ...selected, source }
      : await (async () => {
          if (!port) throw new Error("Legacy installation port is required")
          return port.stageLegacy(selected.prepared.ticket, await convertLegacyExtension(selected.prepared))
        })()
  return executeStagedInstall(runtime, staged, {
    ...options,
    enable: options.enable ?? (!existing && selected.format === "legacy")
  })
}

export interface StagedInstall {
  path: string
  id: string
  version: string
  digest: string
  source: string
}

export async function executeStagedInstall(
  runtime: InstallRuntime,
  staged: StagedInstall,
  options: InstallOptions,
  signal?: AbortSignal
): Promise<InstallResult> {
  signal?.throwIfAborted()
  const { id, source } = staged
  const native = runtime.snapshot().native
  if (!native) throw new Error("Extension service is not ready")
  const existing = native.installations.find(item => item.id === id)
  if (native.pending.some(item => item.id === id)) throw new Error("Extension is transitioning")
  if (existing && !options.update) throw new Error("Extension is already installed")
  if (existing && existing.source !== source) throw new Error("Extension belongs to a different installation source")
  const bounded = <T>(operation: Promise<T>): Promise<T> => {
    if (!signal) return operation
    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => reject(signal.reason)
      signal.addEventListener("abort", aborted, { once: true })
      operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted))
      if (signal.aborted) aborted()
    })
  }
  if (existing?.packageRevision !== staged.digest)
    await bounded(
      runtime.request(
        existing
          ? { type: "beginTransition", id, action: "update", path: staged.path, source, expectedDigest: staged.digest }
          : {
              type: "installLocal",
              path: staged.path,
              source,
              expectedId: id,
              expectedVersion: staged.version,
              expectedDigest: staged.digest
            }
      )
    )
  signal?.throwIfAborted()

  // request() settles this WebView, but another window can still hold the old package.
  await new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    const inspect = (): void => {
      const state = runtime.snapshot().native
      if (!state) {
        unsubscribe?.()
        reject(new Error("Extension service became unavailable"))
        return
      }
      if (state.pending.some(item => item.id === id)) return
      unsubscribe?.()
      const installed = state.installations.find(item => item.id === id)
      if (installed?.packageRevision !== staged.digest || installed.source !== source)
        reject(new Error("Extension installation did not commit the selected package"))
      else resolve()
    }
    const aborted = (): void => {
      unsubscribe?.()
      reject(signal?.reason)
    }
    const stop = runtime.subscribe(inspect)
    unsubscribe = () => {
      stop()
      signal?.removeEventListener("abort", aborted)
    }
    signal?.addEventListener("abort", aborted, { once: true })
    if (signal?.aborted) aborted()
    else inspect()
  })
  signal?.throwIfAborted()
  if (options.enable) await bounded(runtime.request({ type: "enable", id }))
  await bounded(runtime.settled())
  signal?.throwIfAborted()
  const installed = runtime.snapshot().native?.installations.find(item => item.id === id)
  if (!installed) throw new Error("Installed extension disappeared")
  if (installed.packageRevision !== staged.digest || installed.source !== source)
    throw new Error("Selected extension package changed while activation settled")
  const instance = runtime.host.snapshot().instances.find(item => item.id === id && item.revision === staged.digest)
  const active = instance?.status === "active"
  const failure = runtime.snapshot().errors[id] ?? instance?.errors.map(String).join("; ")
  return {
    id,
    version: installed.manifest.version,
    packageRevision: installed.packageRevision,
    installed: true,
    enabled: installed.enabled,
    activeInMainWindow: active,
    error:
      installed.enabled && !active
        ? { code: "activationFailed", message: failure || "Extension did not activate" }
        : null
  }
}
