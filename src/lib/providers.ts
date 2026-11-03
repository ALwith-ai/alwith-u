// U's view of the shared model providers: module-chat owns the catalog, presentation and the chat
// plugin's provider state; these wrappers keep U's call sites on one port.

import {
  applyProvidersWhenIdle as applyWhenIdle,
  createProvidersPort,
  type CustomProviderInput,
  type ProviderInput,
  PROVIDERS_CHANGED,
  type ProviderSnapshot,
  type ProviderTestResult
} from "@alwith/module-chat/settings"

export type {
  CustomModel,
  CustomProvider,
  CustomProviderInput,
  GatewayModel,
  Provider,
  ProviderInput,
  ProviderKey,
  ProviderRegion,
  ProviderSnapshot,
  ProviderTestResult
} from "@alwith/module-chat/settings"
export {
  gatewayModelId,
  isAccountModel,
  MODEL_PRESENTATION,
  parseCustomModels,
  providerGroups,
  providerKeyUrl,
  providerRegion,
  PROVIDERS,
  resolveSessionModel
} from "@alwith/module-chat/settings"
export { PROVIDERS_CHANGED }

/** The chat plugin's provider commands; every window shares the native state. */
export const providersPort = createProvidersPort()

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
