// Model providers as per-session gateways (codex-acp-v2 catalog mode): every provider with a
// saved key registers its models in every chat's model picker under its own group; a chat
// runs on that provider only while one of its models is selected. Nothing in ~/.codex changes.
// Only providers that speak the OpenAI Responses API natively are listed (Codex dropped chat
// completions); Kimi, MiniMax and Zhipu are reached through OpenRouter.

import type { ComponentType, SVGProps } from "react"

import type { GatewayModel } from "@/agent/client"
import type { CustomInput, CustomModel, Input, Metadata, PublicCustomProvider, Snapshot, TestResult } from "@/bindings"
import { commands, events } from "@/bindings"
import { DeepSeekLogo } from "@/components/icons/deepseek-logo"
import { GrokLogo } from "@/components/icons/grok-logo"
import { OpenRouterLogo } from "@/components/icons/openrouter-logo"
import { QwenLogo } from "@/components/icons/qwen-logo"

import catalog from "./provider-catalog.json"

export type { CustomModel } from "@/bindings"
export type ProviderKey = Metadata
export type ProviderInput = Input
export type CustomProvider = PublicCustomProvider
export type CustomProviderInput = CustomInput & { id: string }
export type ProviderSnapshot = Omit<Snapshot, "customProviders" | "managedProviders"> & {
  customProviders: CustomProvider[]
  managedProviders?: CustomProvider[]
}
export type ProviderTestResult = TestResult

export type ProviderRegion = { id: string; baseUrl: string; keyUrl: string }

export type Provider = {
  id: string
  name: string
  logo: ComponentType<SVGProps<SVGSVGElement>>
  /** Single endpoint, or one per region (first region is the default). */
  baseUrl?: string
  regions?: ProviderRegion[]
  keyUrl?: string
  models: GatewayModel[]
  /** Bundled Codex model catalog (resource path) giving the thread real efforts and modalities. */
  catalog?: string
  /** Extra Codex thread-config keys for threads on this provider. */
  config?: Record<string, unknown>
}

const logos: Record<string, Provider["logo"]> = {
  deepseek: DeepSeekLogo,
  openrouter: OpenRouterLogo,
  qwen: QwenLogo,
  xai: GrokLogo
}
export const PROVIDERS: Provider[] = catalog
  .filter((provider) => provider.source !== "account")
  .map((provider) => ({ ...provider, logo: logos[provider.id] }))

export function isAccountModel(model: string | null | undefined): boolean {
  return (
    model != null &&
    catalog.some(
      (provider) => provider.source === "account" && model.startsWith(`gateway:${encodeURIComponent(provider.id)}:`)
    )
  )
}

export function parseCustomModels(source: string): CustomModel[] {
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value) || value.length === 0) throw new Error("Add at least one model")
  const ids = new Set<string>()
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error("Each model must be an object")
    const model = item as Record<string, unknown>
    const label = typeof model.label === "string" ? model.label.trim() : ""
    const apiId = typeof model.api_id === "string" ? model.api_id.trim() : ""
    if (label === "" || apiId === "") throw new Error("Model label and API ID cannot be empty")
    if (ids.has(apiId)) throw new Error("Model IDs must be unique")
    ids.add(apiId)
    if (
      model.contextWindow !== undefined &&
      model.contextWindow !== null &&
      (!Number.isSafeInteger(model.contextWindow) || (model.contextWindow as number) <= 0)
    )
      throw new Error("Model contextWindow must be a positive integer")
    if (model.description !== undefined && typeof model.description !== "string")
      throw new Error("Model description must be a string")
    return {
      label,
      api_id: apiId,
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow as number | null }),
      ...(model.description === undefined ? {} : { description: model.description })
    }
  })
}

export function providerGroups(
  snapshot: ProviderSnapshot
): Array<{ id: string; name: string; models: GatewayModel[] }> {
  return [
    ...PROVIDERS.filter((provider) => snapshot.providers[provider.id] !== undefined).map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models
    })),
    ...[...snapshot.customProviders, ...(snapshot.managedProviders ?? [])].map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.map((model) => ({
        id: model.api_id,
        label: model.label,
        ...(model.description == null ? {} : { description: model.description })
      }))
    }))
  ]
}
export function gatewayModelId(providerId: string, modelId: string): string {
  // Keep persisted IDs stable; the adapter accepts only [a-z0-9-]+. Match providers.rs.
  const runtimeId = providerId.startsWith("custom_")
    ? `custom-${Array.from(new TextEncoder().encode(providerId), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
    : providerId
  return `gateway:${encodeURIComponent(runtimeId)}:${encodeURIComponent(modelId)}`
}

/** Desktop's default selection prefers a user-configured provider; native defaults stay engine-owned. */
export function resolveSessionModel(model: string | null, snapshot: ProviderSnapshot): string | null {
  const models = providerGroups(snapshot).flatMap((group) =>
    group.models.map((entry) => gatewayModelId(group.id, entry.id))
  )
  if (model !== null && (!model.startsWith("gateway:") || models.includes(model))) return model
  if (isAccountModel(model))
    throw new Error("The selected ALwith account model is unavailable. Select another model before sending.")
  return models[0] ?? null
}

export function providerRegion(provider: Provider, regionId: string | null | undefined): ProviderRegion | null {
  if (!provider.regions) return null
  const region = provider.regions.find((entry) => entry.id === regionId) ?? provider.regions[0]
  if (!region) throw new Error(`Provider ${provider.id} declares no regions`)
  return region
}

export function providerKeyUrl(provider: Provider, regionId: string | null | undefined): string | null {
  return providerRegion(provider, regionId)?.keyUrl ?? provider.keyUrl ?? null
}

export function loadProviders(): Promise<ProviderSnapshot> {
  return commands.providersRead()
}
function applyProviders(): Promise<ProviderSnapshot> {
  return commands.providersApply()
}

/** Changes affecting busy provider sessions remain pending in the adapter. */
function providerApplicationPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error)
  return message.includes("Provider settings are pending")
}

/**
 * Apply independent provider changes immediately. Return the current snapshot when
 * affected sessions are busy; Runtime state notifications retry the remaining changes.
 */
export async function applyProvidersWhenIdle(): Promise<ProviderSnapshot> {
  try {
    return await applyProviders()
  } catch (error) {
    if (!providerApplicationPending(error)) throw error
    return loadProviders()
  }
}

export function saveProviderKey(
  revision: number,
  providerId: string,
  input: ProviderInput | null
): Promise<ProviderSnapshot> {
  return commands.providersSave({ providerId, input, expectedRevision: revision })
}
export function saveCustomProvider(revision: number, input: CustomProviderInput): Promise<ProviderSnapshot> {
  return commands.providersSaveCustom({ input, expectedRevision: revision })
}
export function removeCustomProvider(revision: number, providerId: string): Promise<ProviderSnapshot> {
  return commands.providersRemoveCustom({ providerId, expectedRevision: revision })
}
export function testProvider(providerId: string): Promise<ProviderTestResult> {
  return commands.providersTest({ providerId })
}

export const PROVIDERS_CHANGED = events["providers:changed"].name
