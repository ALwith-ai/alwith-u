import type { ExtensionRuntime } from "@alwith/module-extension/host"
import { gt } from "semver"
import { BUNDLED_SOURCE } from "./policy"

export interface BundledExtension {
  id: string
  version: string
  path: string
  source: string
}

export async function ensureBundledExtension(
  runtime: Pick<ExtensionRuntime, "snapshot" | "request">,
  bundle: BundledExtension
): Promise<void> {
  if (bundle.source !== BUNDLED_SOURCE) throw new Error(`Unexpected extension bundle: ${bundle.id}`)
  const native = runtime.snapshot().native
  if (!native) throw new Error("Extension service is not ready")
  if (native.pending.some(item => item.id === bundle.id)) return
  const current = native.installations.find(item => item.id === bundle.id)
  if (!current) {
    await runtime.request({
      type: "installLocal",
      path: bundle.path,
      source: bundle.source,
      expectedId: bundle.id,
      expectedVersion: bundle.version
    })
    await runtime.request({ type: "enable", id: bundle.id })
  } else if (current.source !== BUNDLED_SOURCE) {
    throw new Error(`A local extension already uses bundled identity ${bundle.id}`)
  } else if (gt(bundle.version, current.manifest.version)) {
    await runtime.request({
      type: "beginTransition",
      action: "update",
      id: bundle.id,
      path: bundle.path,
      source: bundle.source
    })
  }
}

export async function ensureBundledExtensions(
  runtime: Pick<ExtensionRuntime, "snapshot" | "request">,
  bundles: readonly BundledExtension[]
): Promise<void> {
  const failures: unknown[] = []
  for (const bundle of bundles) {
    try {
      await ensureBundledExtension(runtime, bundle)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(String).join("; "))
}
