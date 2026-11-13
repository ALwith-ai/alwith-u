// U's view of the shared model providers: module-chat owns the catalog, presentation and the chat
// plugin's provider state; these wrappers keep U's call sites on one port.

import {
  applyProvidersWhenIdle as applyWhenIdle,
  createProvidersPort,
  type CustomProviderInput,
  gatewayModelId,
  isAccountModel as sharedAccountModel,
  providerGroups,
  type ProviderInput,
  PROVIDERS as sharedProviders,
  type ProviderSnapshot,
  type ProviderTestResult
} from "@alwith/module-chat/settings"

export type {
  CustomProvider,
  CustomProviderInput,
  Provider,
  ProviderInput,
  ProviderKey,
  ProviderSnapshot,
  ProviderTestResult
} from "@alwith/module-chat/settings"
export {
  gatewayModelId,
  MODEL_PRESENTATION,
  parseCustomModels,
  providerGroups,
  providerKeyUrl,
  providerRegion
} from "@alwith/module-chat/settings"
import { listen } from "@tauri-apps/api/event"

import { commands } from "@/bindings"
import {
  ENTERPRISE_PROVIDER_PREFIX,
  enterpriseCatalog,
  isEnterpriseModel,
  projectEnterpriseProviders
} from "@/features/auth/enterprise-providers"

// U does not expose Anthropic key configuration.
export const PROVIDERS = sharedProviders.filter((provider) => provider.id !== "anthropic")

/** The chat plugin's provider commands; every window shares the native state. */
const rawProvidersPort = createProvidersPort()
const project = async (snapshot: ProviderSnapshot): Promise<ProviderSnapshot> =>
  projectEnterpriseProviders(snapshot, enterpriseCatalog(await commands.enterpriseCatalog()))
export const providersPort: ReturnType<typeof createProvidersPort> = {
  read: async () => project(await rawProvidersPort.read()),
  save: async (...args) => project(await rawProvidersPort.save(...args)),
  saveCustom: async (...args) => project(await rawProvidersPort.saveCustom(...args)),
  removeCustom: async (...args) => project(await rawProvidersPort.removeCustom(...args)),
  test: (...args) => rawProvidersPort.test(...args),
  apply: async () => project(await rawProvidersPort.apply()),
  onChanged: async (listener) => {
    let revision = 0
    const changed = (snapshot?: ProviderSnapshot) => {
      const expected = ++revision
      void (async () => {
        const result = await project(snapshot ?? (await rawProvidersPort.read()))
        if (expected === revision) listener(result)
      })().catch((error) => console.error("Enterprise provider projection failed", error))
    }
    const stopNative = await listen("enterprise:models-changed", () => changed())
    try {
      const stopShared = await rawProvidersPort.onChanged(changed)
      return () => {
        revision++
        stopNative()
        stopShared()
      }
    } catch (error) {
      stopNative()
      throw error
    }
  }
}

export function isAccountModel(model: string | null | undefined): boolean {
  return sharedAccountModel(model) || isEnterpriseModel(model)
}

/** Preserve strict historical selections; only unsent drafts inherit a replacement default. */
export function resolveSessionModel(
  model: string | null,
  snapshot: ProviderSnapshot,
  purpose: "session" | "draft" = "session"
): string | null {
  const models = providerGroups(snapshot).flatMap((group) =>
    group.models.map((entry) => gatewayModelId(group.id, entry.id))
  )
  if (model?.startsWith("gateway:finture-enterprise:")) {
    const apiId = model.slice("gateway:finture-enterprise:".length)
    const migrated = (snapshot.managedProviders ?? [])
      .filter((provider) => provider.id.startsWith(ENTERPRISE_PROVIDER_PREFIX))
      .flatMap((provider) => provider.models.map((entry) => gatewayModelId(provider.id, entry.api_id)))
      .find((candidate) => candidate.endsWith(`:${apiId}`))
    if (migrated) return migrated
  }
  if (model !== null && (!model.startsWith("gateway:") || models.includes(model))) return model
  if (model !== null && purpose === "session")
    throw new Error("The selected provider connection or model is unavailable. Select another model before sending.")
  return models[0] ?? null
}

export function loadProviders(): Promise<ProviderSnapshot> {
  return providersPort.read()
}

/**
 * Apply independent provider changes immediately. Return the current snapshot when
 * affected sessions are busy; Runtime state notifications apply the remaining changes.
 */
export function applyProvidersWhenIdle(): Promise<ProviderSnapshot> {
  return applyWhenIdle(providersPort)
}

export function saveProviderKey(
  revision: number,
  providerId: string,
  input: ProviderInput | null
): Promise<ProviderSnapshot> {
  return providersPort.save(revision, providerId, input)
}
export function saveCustomProvider(revision: number, input: CustomProviderInput): Promise<ProviderSnapshot> {
  return providersPort.saveCustom(revision, input)
}
export function removeCustomProvider(revision: number, providerId: string): Promise<ProviderSnapshot> {
  return providersPort.removeCustom(revision, providerId)
}
export function testProvider(providerId: string): Promise<ProviderTestResult> {
  return providersPort.test(providerId)
}
