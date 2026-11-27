// U's view of the shared model providers: module-chat owns the catalog, presentation and the chat
// plugin's provider state; these wrappers keep U's call sites on one port.

import {
  applyProvidersWhenIdle as applyWhenIdle,
  createProvidersPort,
  type CustomProviderInput,
  gatewayModelId,
  isAccountModel as sharedAccountModel,
  type ProviderInput,
  PROVIDERS as sharedProviders,
  type ProviderSnapshot,
  type ProviderTestResult,
  type ProviderUsage,
  resolveSessionModel as sharedResolveSessionModel
} from "@alwith/module-chat/settings"

export type {
  CustomProvider,
  CustomProviderInput,
  Provider,
  ProviderInput,
  ProviderKey,
  ProviderSnapshot,
  ProviderTestResult,
  ProviderUsage
} from "@alwith/module-chat/settings"
export {
  gatewayModelId,
  parseCustomModels,
  providerGroups,
  providerKeyUrl,
  providerRegion
} from "@alwith/module-chat/settings"
import { PROVIDER_PREFIX } from "@alwith/enterprise-client/models"
import { listen } from "@tauri-apps/api/event"

import { commands } from "@/bindings"
import { enterpriseCatalog, isEnterpriseModel, projectEnterpriseProviders } from "@/features/auth/enterprise-providers"

import { presentProviderError } from "./provider-errors"

export const PROVIDERS = sharedProviders

/** The chat plugin's provider commands; every window shares the native state. */
const rawProvidersPort = createProvidersPort()
const project = async (snapshot: ProviderSnapshot): Promise<ProviderSnapshot> =>
  projectEnterpriseProviders(presentProviders(snapshot), enterpriseCatalog(await commands.enterpriseCatalog()))

/** Normalize account branding from older native libraries and cached provider names. */
export function presentProviders(snapshot: ProviderSnapshot): ProviderSnapshot {
  return {
    ...snapshot,
    error: snapshot.error === null ? null : presentProviderError(snapshot.error),
    ...(snapshot.managedProviders === undefined
      ? {}
      : {
          managedProviders: snapshot.managedProviders.map((provider) =>
            provider.id === "litellm" ? { ...provider, name: "ALwith" } : provider
          )
        })
  }
}
export const providersPort: ReturnType<typeof createProvidersPort> = {
  read: async () => project(await rawProvidersPort.read()),
  save: async (...args) => project(await rawProvidersPort.save(...args)),
  saveCustom: async (...args) => project(await rawProvidersPort.saveCustom(...args)),
  removeCustom: async (...args) => project(await rawProvidersPort.removeCustom(...args)),
  test: (...args) => rawProvidersPort.test(...args),
  claudeLogin: async (...args) => project(await rawProvidersPort.claudeLogin(...args)),
  claudeLogout: async (...args) => project(await rawProvidersPort.claudeLogout(...args)),
  claudeUsage: () => rawProvidersPort.claudeUsage(),
  apply: async () => project(await rawProvidersPort.apply()),
  onChanged: async (listener) => {
    let revision = 0
    let previous: string | undefined
    const changed = (snapshot?: ProviderSnapshot) => {
      const expected = ++revision
      void (async () => {
        const result = await project(snapshot ?? (await rawProvidersPort.read()))
        if (expected !== revision) return
        // Application status and enterprise models can change without a saved revision change.
        const fingerprint = JSON.stringify(result)
        if (fingerprint === previous) return
        previous = fingerprint
        listener(result)
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

/** The shared resolution, with U's enterprise models as account models and their old ids migrated. */
export function resolveSessionModel(
  model: string | null,
  snapshot: ProviderSnapshot,
  purpose: "session" | "draft" = "session"
): string | null {
  if (model?.startsWith("gateway:finture-enterprise:")) {
    const apiId = model.slice("gateway:finture-enterprise:".length)
    const migrated = (snapshot.managedProviders ?? [])
      .filter((provider) => provider.id.startsWith(PROVIDER_PREFIX))
      .flatMap((provider) => provider.models.map((entry) => gatewayModelId(provider.id, entry.api_id)))
      .find((candidate) => candidate.endsWith(`:${apiId}`))
    if (migrated) return migrated
  }
  return sharedResolveSessionModel(model, snapshot, purpose, isAccountModel)
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
/** Opens the browser for a Claude subscription sign-in; resolves once the user has consented. */
export function claudeLogin(revision: number): Promise<ProviderSnapshot> {
  return providersPort.claudeLogin(revision)
}
export function claudeLogout(revision: number): Promise<ProviderSnapshot> {
  return providersPort.claudeLogout(revision)
}
export function claudeUsage(): Promise<ProviderUsage> {
  return providersPort.claudeUsage()
}
export function testProvider(providerId: string): Promise<ProviderTestResult> {
  return providersPort.test(providerId)
}
