import type { ExtensionRuntime } from "@alwith/module-extension/host"

import { asError, text } from "@/lib/text"

import { convertLegacyExtension, type PreparedLegacyImport } from "./legacy/import"
import { LEGACY_SOURCE } from "./legacy/profiles"

export type PreparedInstall =
  | { format: "current"; path: string; id: string; version: string; digest: string }
  | { format: "legacy"; prepared: PreparedLegacyImport }

interface InstallOptions {
  update: boolean
  reload?: boolean
  /** Omitted enables new installations and preserves the state of updates. */
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
    selected.format === "current" ? selected.id : text((await convertLegacyExtension(selected.prepared)).manifest.id)
  const source = selected.format === "current" ? "local" : LEGACY_SOURCE
  const native = runtime.snapshot().native
  if (!native) throw new Error("Extension service is not ready")
  const existing = native.installations.find((item) => item.id === id)
  if (native.pending.some((item) => item.id === id)) throw new Error("Extension is transitioning")
  if (existing && !options.update) throw new Error("Extension is already installed; choose update")
  if (existing && existing.source !== source) throw new Error("Extension belongs to a different installation source")
  const staged =
    selected.format === "current"
      ? { ...selected, source }
      : await (async () => {
          if (!port) throw new Error("Legacy installation port is required")
          return port.stageLegacy(selected.prepared.ticket, await convertLegacyExtension(selected.prepared))
        })()
  return executeStagedInstall(runtime, staged, options)
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
  const existing = native.installations.find((item) => item.id === id)
  if (native.pending.some((item) => item.id === id)) throw new Error("Extension is transitioning")
  if (existing && !options.update) throw new Error("Extension is already installed")
  if (existing && existing.source !== source) throw new Error("Extension belongs to a different installation source")
  const bounded = <T>(operation: Promise<T>): Promise<T> => {
    if (!signal) return operation
    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => reject(asError(signal.reason))
      signal.addEventListener("abort", aborted, { once: true })
      operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted))
      if (signal.aborted) aborted()
    })
  }
  const reloading = Boolean(options.reload && existing?.packageRevision === staged.digest)
  const activationRevision = existing?.activationRevision ?? 0
  if (reloading) {
    if (!existing?.enabled) throw new Error("Disabled extensions cannot be reloaded")
    await bounded(runtime.request({ type: "beginTransition", id, action: "reload" }))
  } else if (existing?.packageRevision !== staged.digest)
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
      if (state.pending.some((item) => item.id === id)) return
      unsubscribe?.()
      const installed = state.installations.find((item) => item.id === id)
      if (installed?.packageRevision !== staged.digest || installed.source !== source)
        reject(new Error("Extension installation did not commit the selected package"))
      else if (reloading && (installed.activationRevision ?? 0) !== activationRevision + 1)
        reject(new Error("Extension reload did not commit"))
      else resolve()
    }
    const aborted = (): void => {
      unsubscribe?.()
      reject(asError(signal?.reason))
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
  if (options.enable ?? !existing) await bounded(runtime.request({ type: "enable", id }))
  await bounded(runtime.settled())
  signal?.throwIfAborted()
  const installed = runtime.snapshot().native?.installations.find((item) => item.id === id)
  if (!installed) throw new Error("Installed extension disappeared")
  if (installed.packageRevision !== staged.digest || installed.source !== source)
    throw new Error("Selected extension package changed while activation settled")
  const instance = runtime.host.snapshot().instances.find((item) => item.id === id && item.revision === staged.digest)
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

/** Reload preserves native enable intent, package identity and data generation. */
export async function executeReload(runtime: InstallRuntime, id: string, signal: AbortSignal): Promise<InstallResult> {
  const native = runtime.snapshot().native
  const installed = native?.installations.find((item) => item.id === id)
  if (!installed?.enabled) throw new Error("Extension is not installed and enabled")
  return executeStagedInstall(
    runtime,
    {
      id,
      source: installed.source,
      digest: installed.packageRevision,
      version: installed.manifest.version,
      path: ""
    },
    { update: true, enable: false, reload: true },
    signal
  )
}
