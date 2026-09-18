// Model providers as per-session gateways (codex-acp-v2 catalog mode): every provider with a
// saved key registers its models in every chat's model picker under its own group; a chat
// runs on that provider only while one of its models is selected. Nothing in ~/.codex changes.
// Only providers that speak the OpenAI Responses API natively are listed (Codex dropped chat
// completions); Kimi, MiniMax and Zhipu are reached through OpenRouter.
import { invoke } from "@tauri-apps/api/core"
import catalog from "./provider-catalog.json"
import type { ComponentType, SVGProps } from "react"
import { DeepSeekLogo } from "@/components/icons/deepseek-logo"
import { GrokLogo } from "@/components/icons/grok-logo"
import { OpenRouterLogo } from "@/components/icons/openrouter-logo"
import { QwenLogo } from "@/components/icons/qwen-logo"
import type { GatewayModel } from "@/agent/client"
export type ProviderKey = { configured: boolean; region?: string | null }
export type ProviderInput = { apiKey?: string; region?: string }
export type ProviderSnapshot = {
  revision: number
  appliedRevision: number | null
  providers: Record<string, ProviderKey>
  status: "pending" | "applied" | "failed"
  error: string | null
}
export const PROVIDERS_CHANGED = "providers:changed"

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
export const PROVIDERS: Provider[] = catalog.map(provider => ({ ...provider, logo: logos[provider.id] }))
export function gatewayModelId(providerId: string, modelId: string): string {
  return `gateway:${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`
}

export function providerRegion(provider: Provider, regionId: string | null | undefined): ProviderRegion | null {
  if (!provider.regions) return null
  const region = provider.regions.find(entry => entry.id === regionId) ?? provider.regions[0]
  if (!region) throw new Error(`Provider ${provider.id} declares no regions`)
  return region
}

export function providerKeyUrl(provider: Provider, regionId: string | null | undefined): string | null {
  return providerRegion(provider, regionId)?.keyUrl ?? provider.keyUrl ?? null
}

export function loadProviders(): Promise<ProviderSnapshot> {
  return invoke("providers_read")
}
export function applyProviders(): Promise<ProviderSnapshot> {
  return invoke("providers_apply")
}
export function saveProviderKey(
  revision: number,
  providerId: string,
  input: ProviderInput | null
): Promise<ProviderSnapshot> {
  return invoke("providers_save", { providerId, input, expectedRevision: revision })
}
