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
import { isEnterpriseModel } from "@/features/auth/enterprise-providers"

// U does not expose Anthropic key configuration.
export const PROVIDERS = sharedProviders.filter((provider) => provider.id !== "anthropic")

/** Configuration results belong exclusively to the shared chat provider store. */
export const providersPort = createProvidersPort()

export const isAccountModel = sharedAccountModel
export function isAccountBoundModel(model: string | null | undefined): boolean {
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
  if (model !== null && (!model.startsWith("gateway:") || models.includes(model))) return model
  if (isAccountBoundModel(model) && purpose === "session")
    throw new Error(
      isEnterpriseModel(model)
        ? "The selected enterprise model is unavailable. Select another model before sending."
        : "The selected ALwith account model is unavailable. Select another model before sending."
    )
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
