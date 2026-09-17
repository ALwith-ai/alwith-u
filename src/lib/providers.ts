// Model providers as per-session gateways (codex-acp-v2 catalog mode): every provider with a
// saved key registers its models in every chat's model picker under its own group; a chat
// runs on that provider only while one of its models is selected. Nothing in ~/.codex changes.
// Only providers that speak the OpenAI Responses API natively are listed (Codex dropped chat
// completions); Kimi, MiniMax and Zhipu are reached through OpenRouter.
import { resolveResource } from "@tauri-apps/api/path"
import type { ComponentType, SVGProps } from "react"
import { DeepSeekLogo } from "@/components/icons/deepseek-logo"
import { GrokLogo } from "@/components/icons/grok-logo"
import { OpenRouterLogo } from "@/components/icons/openrouter-logo"
import { QwenLogo } from "@/components/icons/qwen-logo"
import type { GatewayConfig, GatewayModel } from "@/agent/client"
import { client } from "@/lib/client"
import { type ProviderKey, savePreference } from "@/lib/preferences"

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

export const PROVIDERS: Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: DeepSeekLogo,
    baseUrl: "https://api.deepseek.com/",
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      {
        id: "deepseek-flash",
        label: "DeepSeek-Flash",
        description: "Latest frontier agentic coding model with image input."
      }
    ],
    catalog: "deepseek/models.json",
    // What DeepSeek's own Codex setup sets, scoped here to threads on DeepSeek.
    config: { web_search: "disabled" }
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    logo: OpenRouterLogo,
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    // Ids verified against https://openrouter.ai/api/v1/models on 2026-09-11.
    models: [
      { id: "moonshotai/kimi-k3", label: "Kimi K3" },
      { id: "minimax/minimax-m3", label: "MiniMax M3" },
      { id: "z-ai/glm-5.3", label: "GLM 5.3" },
      { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "qwen/qwen3.8-max-0902", label: "Qwen 3.8 Max" },
      { id: "x-ai/grok-4.6", label: "Grok 4.6" }
    ]
  },
  {
    id: "qwen",
    name: "Qwen",
    logo: QwenLogo,
    regions: [
      {
        id: "intl",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        keyUrl: "https://modelstudio.console.alibabacloud.com/?tab=model#/api-key"
      },
      {
        id: "cn",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        keyUrl: "https://bailian.console.aliyun.com/#/api-key"
      }
    ],
    models: [
      { id: "qwen3.8-max", label: "3.8 Max" },
      { id: "qwen3.8-flash", label: "3.8 Flash" },
      { id: "qwen3.7-max", label: "3.7 Max" },
      { id: "qwen3.7-plus", label: "3.7 Plus" },
      { id: "qwen3.6-flash", label: "3.6 Flash" }
    ]
  },
  {
    id: "xai",
    name: "xAI",
    logo: GrokLogo,
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    models: [
      { id: "grok-4.6", label: "Grok 4.6" },
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4.3", label: "Grok 4.3" }
    ]
  }
]

export function providerRegion(provider: Provider, regionId: string | undefined): ProviderRegion | null {
  if (!provider.regions) return null
  const region = provider.regions.find(entry => entry.id === regionId) ?? provider.regions[0]
  if (!region) throw new Error(`Provider ${provider.id} declares no regions`)
  return region
}

export function providerKeyUrl(provider: Provider, regionId: string | undefined): string | null {
  return providerRegion(provider, regionId)?.keyUrl ?? provider.keyUrl ?? null
}

async function gatewayConfig(provider: Provider, key: ProviderKey): Promise<GatewayConfig> {
  const region = providerRegion(provider, key.region)
  const baseUrl = region?.baseUrl ?? provider.baseUrl
  if (baseUrl === undefined) throw new Error(`Provider ${provider.id} has no endpoint`)
  const config: Record<string, unknown> = { ...provider.config }
  if (provider.catalog) config.model_catalog_json = await resolveResource(provider.catalog)
  return { id: provider.id, name: provider.name, baseUrl, bearerToken: key.apiKey, models: provider.models, config }
}

/**
 * Registers every provider that has a key and removes the ones that lost theirs. No-op when
 * the connected agent cannot host gateway models.
 */
export async function applyProviders(keys: Record<string, ProviderKey>): Promise<void> {
  if (!client.providerCatalog) return
  for (const id of client.gatewayIds) if (!(id in keys)) await client.unregisterGateway(id)
  for (const provider of PROVIDERS) {
    const key = keys[provider.id]
    if (key) await client.registerGateway(await gatewayConfig(provider, key))
  }
}

/** Saves one provider's key (or removes it) and applies the whole table on the live connection. */
export async function saveProviderKey(
  keys: Record<string, ProviderKey>,
  providerId: string,
  key: ProviderKey | null
): Promise<Record<string, ProviderKey>> {
  const next = { ...keys }
  if (key === null) delete next[providerId]
  else next[providerId] = key
  await savePreference("providerKeys", next)
  if (client.state.connection === "ready") await applyProviders(next)
  return next
}
