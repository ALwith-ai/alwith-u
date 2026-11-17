import type { PluginServiceAuth, PluginSummary } from "@alwith/module-chat/client"
import { z } from "zod"

type PluginInterface = NonNullable<PluginSummary["interface"]>
export type PluginCatalogEntry = { plugin: PluginSummary; marketplaceName: string; marketplacePath: string | null }
export type PluginCatalogPage = { data: PluginCatalogEntry[]; nextCursor: string | null }
type PageParams = {
  cursor?: string | null
  limit?: number | null
  signal?: AbortSignal
  accountId?: string | null
}
export type PluginCatalogApi = {
  identity: () => Promise<string | null>
  catalogPlugins: (params?: PageParams) => Promise<PluginCatalogPage>
  searchPlugins: (params: PageParams & { searchTerm: string }) => Promise<PluginCatalogPage>
}
export type PluginMarketplaceOptions = {
  readAuth: (refreshToken: boolean) => Promise<PluginServiceAuth | null>
  fetch: (input: URL, init: RequestInit) => Promise<Response>
}
const text = z.string().nullish()
const interfaceSchema = z.object({
  short_description: text,
  long_description: text,
  developer_name: text,
  category: text,
  capabilities: z.array(z.string()).nullish(),
  website_url: text,
  privacy_policy_url: text,
  terms_of_service_url: text,
  default_prompt: text,
  default_prompts: z.array(z.string()).nullish(),
  brand_color: text,
  composer_icon_url: text,
  logo_url: text,
  logo_url_dark: text,
  screenshot_urls: z.array(z.string()).nullish()
})
const pluginSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  installation_policy: z.enum(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]),
  installation_policy_source: z.enum(["WORKSPACE_SETTING", "IMPLICIT_CANONICAL_APP"]).nullish(),
  must_show_installation_interstitial: z.boolean().nullish(),
  authentication_policy: z.enum(["ON_INSTALL", "ON_USE"]),
  // Match Codex's plugin-service alias and omitted-field default.
  status: z
    .enum(["AVAILABLE", "ENABLED", "DISABLED_BY_ADMIN"])
    .default("AVAILABLE")
    .transform((value) => (value === "ENABLED" ? "AVAILABLE" : value)),
  disabled_reason: z.enum(["disabled_by_admin", "plan_not_eligible", "required_app_unavailable", "unknown"]).nullish(),
  eligible_plan_types: z.array(z.string()).nullish(),
  release: z.object({
    version: text,
    display_name: text,
    description: text,
    keywords: z.array(z.string()).nullish(),
    interface: interfaceSchema.nullish()
  })
})
const pageSchema = z.object({
  plugins: z.array(pluginSchema),
  pagination: z.object({ next_page_token: text })
})

function summary(entry: z.infer<typeof pluginSchema>): PluginSummary {
  const release = entry.release
  const source = release.interface
  const prompts = source?.default_prompts ?? (source?.default_prompt ? [source.default_prompt] : null)
  const info: PluginInterface = {
    displayName: release.display_name ?? entry.name,
    shortDescription: source?.short_description ?? release.description ?? null,
    longDescription: source?.long_description ?? release.description ?? null,
    developerName: source?.developer_name ?? null,
    category: source?.category ?? null,
    capabilities: source?.capabilities ?? [],
    websiteUrl: source?.website_url ?? null,
    privacyPolicyUrl: source?.privacy_policy_url ?? null,
    termsOfServiceUrl: source?.terms_of_service_url ?? null,
    defaultPrompt: prompts?.slice(0, 3).map((prompt) => prompt.slice(0, 512)) ?? null,
    brandColor: source?.brand_color ?? null,
    composerIcon: null,
    composerIconUrl: source?.composer_icon_url ?? null,
    logo: null,
    logoDark: null,
    logoUrl: source?.logo_url ?? null,
    logoUrlDark: source?.logo_url_dark ?? null,
    screenshots: [],
    screenshotUrls: source?.screenshot_urls ?? []
  }
  return {
    id: `${entry.name}@openai-curated-remote`,
    remotePluginId: entry.id,
    version: release.version ?? null,
    localVersion: null,
    name: entry.name,
    shareContext: null,
    source: { type: "remote" },
    installed: false,
    installedAt: null,
    enabled: false,
    installPolicy: entry.installation_policy,
    installPolicySource: entry.installation_policy_source ?? null,
    mustShowInstallationInterstitial: entry.must_show_installation_interstitial ?? null,
    authPolicy: entry.authentication_policy,
    availability: entry.status,
    disabledReason: entry.disabled_reason ?? null,
    eligiblePlanTypes: entry.eligible_plan_types ?? null,
    interface: info,
    keywords: release.keywords ?? []
  }
}

function backend(auth: PluginServiceAuth): URL {
  const origin = new URL(auth.backendOrigin)
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    (origin.hostname !== "chatgpt.com" && !origin.hostname.endsWith(".chatgpt.com"))
  )
    throw new Error("Unsupported ChatGPT plugin-service origin")
  return origin
}

export class PluginAccountChangedError extends Error {}

/** HTTP catalog requests belong to U; only authentication reuses the Codex connection. */
export function createPluginMarketplace(options: PluginMarketplaceOptions): PluginCatalogApi {
  async function request(searchTerm: string | null, params: PageParams = {}): Promise<PluginCatalogPage> {
    const limit = params.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("Plugin page limit must be between 1 and 50")
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(params.signal ? [params.signal] : [])])
    signal.throwIfAborted()
    const first = await options.readAuth(false)
    signal.throwIfAborted()
    if (params.accountId !== undefined && params.accountId !== (first?.accountId ?? null))
      throw new PluginAccountChangedError("ChatGPT account changed; refresh the plugin directory")
    if (!first) return { data: [], nextCursor: null }
    const url = new URL(
      searchTerm === null ? "/backend-api/ps/plugins/list" : "/backend-api/ps/plugins/search",
      backend(first)
    )
    url.searchParams.set("scope", "GLOBAL")
    url.searchParams.set("limit", String(limit))
    if (params.cursor) url.searchParams.set("pageToken", params.cursor)
    if (searchTerm !== null) url.searchParams.set("q", searchTerm)
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = attempt === 0 ? first : await options.readAuth(true)
      signal.throwIfAborted()
      if (!auth || auth.accountId !== first.accountId || backend(auth).origin !== url.origin)
        throw new PluginAccountChangedError("ChatGPT account changed while loading plugins; refresh the directory")
      const response = await options.fetch(url, {
        method: "GET",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "ChatGPT-Account-ID": auth.accountId,
          "OpenAI-Product-SKU": "codex"
        }
      })
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel()
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Plugin marketplace request failed (HTTP ${response.status})`)
      }
      const parsed = pageSchema.safeParse(await response.json())
      signal.throwIfAborted()
      if (!parsed.success) throw new Error("Plugin marketplace returned an invalid page")
      const page = parsed.data
      if (page.plugins.length > limit) throw new Error("Plugin marketplace exceeded the requested page size")
      return {
        data: page.plugins.map((entry) => ({
          plugin: summary(entry),
          marketplaceName: "openai-curated-remote",
          marketplacePath: null
        })),
        nextCursor: page.pagination.next_page_token ?? null
      }
    }
    throw new Error("Plugin marketplace authentication failed")
  }
  return {
    identity: async () => (await options.readAuth(false))?.accountId ?? null,
    catalogPlugins: (params) => request(null, params),
    searchPlugins: ({ searchTerm, ...params }) => request(searchTerm, params)
  }
}
