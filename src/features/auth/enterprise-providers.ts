import { type CustomProvider, gatewayModelId, type ProviderSnapshot } from "@alwith/module-chat/settings"

const ENTERPRISE_PROVIDER_PREFIX = "custom_alwith_enterprise_"
const MODEL_PREFIX = gatewayModelId(ENTERPRISE_PROVIDER_PREFIX, "").split(":")[1]!

export function isEnterpriseModel(model: string | null | undefined): boolean {
  return !!model && (model.startsWith(`gateway:${MODEL_PREFIX}`) || model.startsWith("gateway:finture-enterprise:"))
}

/** Enterprise metadata joins the shared model picker; relay credentials stay in native memory. */
export function projectEnterpriseProviders(
  snapshot: ProviderSnapshot,
  provider: CustomProvider | null
): ProviderSnapshot {
  return {
    ...snapshot,
    customProviders: snapshot.customProviders.filter((provider) => !provider.id.startsWith(ENTERPRISE_PROVIDER_PREFIX)),
    managedProviders: [...(snapshot.managedProviders ?? []), ...(provider === null ? [] : [provider])]
  }
}

export function enterpriseCatalog(value: unknown): CustomProvider | null {
  if (value === null) return null
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid enterprise catalog")
  const provider = value as CustomProvider
  if (
    !provider.id?.startsWith(ENTERPRISE_PROVIDER_PREFIX) ||
    !provider.name?.trim() ||
    typeof provider.baseUrl !== "string" ||
    !Array.isArray(provider.models) ||
    !provider.models.length ||
    "apiKey" in value
  )
    throw new Error("Invalid enterprise catalog")
  return provider
}
