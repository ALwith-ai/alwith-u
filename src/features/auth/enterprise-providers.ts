import { isEnterpriseModel as isConnectionModel, PROVIDER_PREFIX } from "@alwith/enterprise-client/models"
import type { CustomProvider, ProviderSnapshot } from "@alwith/module-chat/settings"

/** Enterprise connection models, and the platform-issued IDs older sessions still hold. */
export function isEnterpriseModel(model: string | null | undefined): boolean {
  return isConnectionModel(model) || !!model?.startsWith("gateway:finture-enterprise:")
}

/** Enterprise metadata joins the shared model picker; relay credentials stay in native memory. */
export function projectEnterpriseProviders(
  snapshot: ProviderSnapshot,
  provider: CustomProvider | null
): ProviderSnapshot {
  return {
    ...snapshot,
    customProviders: snapshot.customProviders.filter((provider) => !provider.id.startsWith(PROVIDER_PREFIX)),
    managedProviders: [...(snapshot.managedProviders ?? []), ...(provider === null ? [] : [provider])]
  }
}

export function enterpriseCatalog(value: unknown): CustomProvider | null {
  if (value === null) return null
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid enterprise catalog")
  const provider = value as CustomProvider
  if (
    !provider.id?.startsWith(PROVIDER_PREFIX) ||
    !provider.name?.trim() ||
    typeof provider.baseUrl !== "string" ||
    !Array.isArray(provider.models) ||
    !provider.models.length ||
    "apiKey" in value
  )
    throw new Error("Invalid enterprise catalog")
  return provider
}
