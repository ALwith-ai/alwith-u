import type { CustomProvider, ProviderSnapshot } from "@alwith/module-chat/settings"

import { commands } from "@/bindings"
import { enterpriseCatalog, isEnterpriseModel } from "@/features/auth/enterprise-providers"
import { usePlatformAuth } from "@/features/auth/store"

import { applyProvidersWhenIdle, gatewayModelId, isAccountBoundModel, resolveSessionModel } from "./providers"

interface ModelResolutionHost {
  account?(): object | null
  shared(): Promise<ProviderSnapshot>
  enterprise(): Promise<CustomProvider | null>
}
const host: ModelResolutionHost = {
  account: () => usePlatformAuth.getState().user,
  shared: applyProvidersWhenIdle,
  enterprise: async () => enterpriseCatalog(await commands.enterpriseCatalog())
}

/** Resolve only the selected source; native admission remains authoritative for execution. */
export async function resolveConfiguredModel(
  model: string | null,
  purpose: "session" | "draft",
  sources: ModelResolutionHost = host
): Promise<string | null> {
  const account = sources.account?.()
  const result = await resolveFromSources(model, purpose, sources)
  if (sources.account && sources.account() !== account)
    throw new Error("ALwith account changed during model resolution")
  return result
}

async function resolveFromSources(
  model: string | null,
  purpose: "session" | "draft",
  sources: ModelResolutionHost
): Promise<string | null> {
  if (model !== null && !model.startsWith("gateway:")) return model
  if (isEnterpriseModel(model)) {
    const provider = await sources.enterprise()
    const models = provider?.models.map((entry) => gatewayModelId(provider.id, entry.api_id)) ?? []
    const migrated = model?.startsWith("gateway:finture-enterprise:")
      ? models.find((candidate) => candidate.endsWith(`:${model.slice("gateway:finture-enterprise:".length)}`))
      : models.find((candidate) => candidate === model)
    if (migrated) return migrated
    if (purpose === "session")
      throw new Error("The selected enterprise model is unavailable. Select another model before sending.")
    return resolveSessionModel(null, await sources.shared(), purpose)
  }
  let shared: ProviderSnapshot
  try {
    shared = await sources.shared()
  } catch (error) {
    if (model !== null) throw error
    console.error("Default provider catalog unavailable", error)
    return enterpriseDefault(null, sources)
  }
  if (shared.status === "pending" && !isAccountBoundModel(model)) return null
  const selected = resolveSessionModel(model, shared, purpose)
  if (selected !== null || (model !== null && purpose === "session")) return selected
  return enterpriseDefault(selected, sources)
}

async function enterpriseDefault(selected: string | null, sources: ModelResolutionHost): Promise<string | null> {
  try {
    const enterprise = await sources.enterprise()
    const first = enterprise?.models[0]
    return enterprise && first ? gatewayModelId(enterprise.id, first.api_id) : selected
  } catch (error) {
    console.error("Enterprise default catalog unavailable", error)
    return selected
  }
}
