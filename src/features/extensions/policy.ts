import type { CapabilityProvider } from "@alwith/module-extension/host"
// Must match the native grant's stable source; existing installations retain this identity.
export const BUNDLED_SOURCE = "bundled:alwith-u"

interface ExtensionIdentity {
  id: string
  source: string
}

export function extensionActions(installation: ExtensionIdentity): { update: boolean; uninstall: boolean } {
  const bundled = installation.source === BUNDLED_SOURCE
  return { update: !bundled, uninstall: !bundled }
}

/** Check native installation provenance, not the manifest's self-reported id alone. */
export function authorizeCapability<T>(
  capabilityId: string,
  provider: CapabilityProvider<T>,
  installation: (id: string) => ExtensionIdentity | undefined
): CapabilityProvider<T> {
  return {
    version: provider.version,
    create(binding) {
      binding.cancellation.throwIfAborted()
      const selected = installation(binding.manifest.id)
      if (!selected || selected.id !== binding.manifest.id || selected.source !== BUNDLED_SOURCE)
        throw new Error(`Extension ${binding.manifest.id} is not authorized for ${capabilityId}`)
      return provider.create ? provider.create(binding) : provider.value
    }
  }
}
