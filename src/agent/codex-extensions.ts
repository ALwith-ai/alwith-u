// Codex skills and plugin marketplace shapes, as exposed by codex-acp-v2's `_codex/*`
// extension methods. Copied from the Codex app-server v2 types, trimmed to what the
// client reads. Keep in step with `@nyssance/codex-acp-v2` docs/protocol.md.
import type { TurnError } from "@alwith/api"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"

export type SkillScope = "user" | "repo" | "system" | "admin"

export type SkillInterface = {
  displayName?: string
  shortDescription?: string
  /** Absolute paths of the skill's own icon files (Codex `AbsolutePathBuf`). */
  iconSmall?: string | null
  iconLarge?: string | null
  iconSmallUrl: string | null
  iconLargeUrl: string | null
  brandColor?: string
  defaultPrompt?: string
}

export type SkillMetadata = {
  name: string
  description: string
  shortDescription?: string
  interface?: SkillInterface
  path: string
  scope: SkillScope
  enabled: boolean
  /** Owning plugin id (`PluginSummary.id`) when the skill ships with a plugin. */
  pluginId: string | null
}

export type SkillErrorInfo = { path: string; message: string }

export type SkillsListEntry = { cwd: string; skills: SkillMetadata[]; errors: SkillErrorInfo[] }

export type SkillsListParams = { cwds?: string[]; forceReload?: boolean }
export type SkillsListResponse = { data: SkillsListEntry[] }

export type SkillsConfigWriteParams = { path?: string | null; name?: string | null; enabled: boolean }
export type SkillsConfigWriteResponse = { effectiveEnabled: boolean }

export type PluginSource =
  | { type: "local"; path: string }
  | { type: "git"; url: string; path: string | null; refName: string | null; sha: string | null }
  | { type: "npm"; package: string; version: string | null; registry: string | null }
  | { type: "remote" }

export type PluginInstallPolicy = "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT"
export type PluginAvailability = "AVAILABLE" | "DISABLED_BY_ADMIN"
export type PluginAuthPolicy = "ON_INSTALL" | "ON_USE"

export type PluginInterface = {
  displayName: string | null
  shortDescription: string | null
  longDescription: string | null
  developerName: string | null
  category: string | null
  capabilities: string[]
  websiteUrl: string | null
  privacyPolicyUrl: string | null
  termsOfServiceUrl: string | null
  /** Starter prompts for the plugin (at most 3). */
  defaultPrompt: string[] | null
  brandColor: string | null
  /** Local composer icon path, resolved from the installed plugin package. */
  composerIcon: string | null
  composerIconUrl: string | null
  /** Local logo paths, resolved from the installed plugin package. */
  logo: string | null
  logoDark: string | null
  logoUrl: string | null
  logoUrlDark: string | null
  screenshots: string[]
  screenshotUrls: string[]
}

export type PluginInstallPolicySource = "WORKSPACE_SETTING" | "IMPLICIT_CANONICAL_APP"
export type PluginDisabledReason = "PLAN_NOT_ELIGIBLE" | "REQUIRED_APP_UNAVAILABLE" | "UNKNOWN"

export type PluginShareContext = {
  remotePluginId: string
  remoteVersion: string | null
  shareUrl: string | null
  creatorName: string | null
}

export type PluginSummary = {
  id: string
  remotePluginId: string | null
  version: string | null
  localVersion: string | null
  name: string
  source: PluginSource
  shareContext: PluginShareContext | null
  installed: boolean
  /** Unix timestamp in seconds when the plugin was installed, when available. */
  installedAt: number | null
  enabled: boolean
  installPolicy: PluginInstallPolicy
  installPolicySource: PluginInstallPolicySource | null
  /** The official client shows its install interstitial (About, Includes) first when true. */
  mustShowInstallationInterstitial: boolean | null
  availability: PluginAvailability
  authPolicy: PluginAuthPolicy
  /** Why the remote plugin is unavailable, when plugin-service says. */
  disabledReason: PluginDisabledReason | null
  eligiblePlanTypes: string[] | null
  interface: PluginInterface | null
  keywords: string[]
}

export type PluginMarketplaceEntry = {
  name: string
  /** Local marketplace file; remote catalogs have none. */
  path: string | null
  interface: { displayName: string | null } | null
  plugins: PluginSummary[]
}

export type MarketplaceLoadErrorInfo = { marketplacePath: string; message: string }

export type PluginListParams = { cwds?: string[] | null; forceRefetch?: boolean }
export type PluginListResponse = {
  marketplaces: PluginMarketplaceEntry[]
  marketplaceLoadErrors: MarketplaceLoadErrorInfo[]
  featuredPluginIds: string[]
}

export type PluginInstalledParams = { cwds?: string[] | null }
export type PluginInstalledResponse = {
  marketplaces: PluginMarketplaceEntry[]
  marketplaceLoadErrors: MarketplaceLoadErrorInfo[]
}

export type PluginInstallParams = {
  marketplacePath?: string | null
  remoteMarketplaceName?: string | null
  installAttemptId?: string | null
  pluginName: string
}
export type AppSummary = {
  id: string
  name: string
  description: string | null
  installUrl: string | null
  category: string | null
}
export type PluginInstallResponse = { authPolicy: PluginAuthPolicy; appsNeedingAuth: AppSummary[] }

export type PluginUninstallParams = { pluginId: string }

export type PluginReadParams = {
  marketplacePath?: string | null
  remoteMarketplaceName?: string | null
  pluginName: string
}
export type SkillSummary = {
  name: string
  description: string
  shortDescription: string | null
  interface: SkillInterface | null
  path: string | null
  enabled: boolean
}
export type PluginHookSummary = { key: string; eventName: string }
export type ScheduledTaskSummary = { key: string; name: string; prompt: string }
export type PluginDetail = {
  marketplaceName: string
  marketplacePath: string | null
  summary: PluginSummary
  shareUrl: string | null
  description: string | null
  skills: SkillSummary[]
  hooks: PluginHookSummary[]
  apps: AppSummary[]
  mcpServers: string[]
  scheduledTasks: ScheduledTaskSummary[] | null
}
export type PluginReadResponse = { plugin: PluginDetail }

export type MarketplaceAddParams = { source: string; refName?: string | null; sparsePaths?: string[] | null }
export type MarketplaceAddResponse = { marketplaceName: string; installedRoot: string; alreadyAdded: boolean }
export type MarketplaceRemoveParams = { marketplaceName: string }
export type MarketplaceUpgradeParams = { marketplaceName?: string | null }
export type MarketplaceUpgradeErrorInfo = { marketplaceName: string; message: string }
export type MarketplaceUpgradeResponse = {
  selectedMarketplaces: string[]
  upgradedRoots: string[]
  errors: MarketplaceUpgradeErrorInfo[]
}

// ── Account, rate limits, rename, file search (codex-acp-v2 0.6.0 pass-throughs) ──

export type PlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "self_serve_business_prolite"
  | "self_serve_business_usage_based"
  | "business"
  | "ent26"
  | "enterprise_cbp_automation"
  | "enterprise_cbp_usage_based"
  | "enterprise"
  | "edu"
  | "edu_plus"
  | "edu_pro"
  | "unknown"

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: PlanType }
  | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean }

export type AccountReadResponse = { account: CodexAccount | null; requiresOpenaiAuth: boolean }

export type RateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  /** Unix seconds. */
  resetsAt: number | null
}
export type CreditsSnapshot = { hasCredits: boolean; unlimited: boolean; balance: string | null }
export type RateLimitSnapshot = {
  limitId: string | null
  limitName: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  credits: CreditsSnapshot | null
  spendControlReached: boolean | null
  planType: PlanType | null
}
export type RateLimitsResponse = { rateLimits: RateLimitSnapshot }

export type FuzzyFileSearchParams = { query: string; roots: string[]; cancellationToken?: string | null }
export type FuzzyFileSearchResult = {
  root: string
  path: string
  match_type: "file" | "directory"
  file_name: string
  score: number
  indices: number[] | null
}
export type FuzzyFileSearchResponse = { files: FuzzyFileSearchResult[] }
export type FuzzyFileSearchSessionUpdated = { sessionId: string; query: string; files: FuzzyFileSearchResult[] }

/** What the adapter advertised under `capabilities._meta.codex`. */
export type CodexExtensionCapabilities = {
  skills: boolean
  plugins: boolean
  rename: boolean
  account: boolean
  fuzzyFileSearch: boolean
}

export function codexExtensionCapabilities(agent: acp.InitializeResponse | null): CodexExtensionCapabilities {
  const codex = agent?.capabilities?._meta?.codex
  const flags = typeof codex === "object" && codex !== null ? (codex as Record<string, unknown>) : {}
  return {
    skills: flags.skills === true,
    plugins: flags.plugins === true,
    rename: flags.rename === true,
    account: flags.account === true,
    fuzzyFileSearch: flags.fuzzyFileSearch === true
  }
}

/** Single-boolean store selectors (a fresh object per call would re-render forever). */
export function hasRename(agent: acp.InitializeResponse | null): boolean {
  return codexExtensionCapabilities(agent).rename
}
export function hasAccount(agent: acp.InitializeResponse | null): boolean {
  return codexExtensionCapabilities(agent).account
}
export function hasFuzzyFileSearch(agent: acp.InitializeResponse | null): boolean {
  return codexExtensionCapabilities(agent).fuzzyFileSearch
}

/**
 * Store selector: a single boolean, so `useStore` sees a stable value. Selecting the
 * capabilities object itself re-renders forever (a new object every call).
 */
export function hasPluginStore(agent: acp.InitializeResponse | null): boolean {
  const capabilities = codexExtensionCapabilities(agent)
  return capabilities.skills || capabilities.plugins
}

/**
 * 一轮失败时界面要说的话。协议只给 `stopReason`,详情在 idle 帧的 `_meta` 里,
 * 每家芯放法不同 —— codex 放 `_meta.codex.error`。`@alwith/api` 原样交出 `_meta`,
 * 这里把它读成 codex 的那一份。
 */
export type CodexTurnError = {
  message: string
  category: string | null
  retryable: boolean
}

export function codexTurnError(error: TurnError): CodexTurnError {
  const codex = error.meta?.codex
  const detail =
    typeof codex === "object" && codex !== null
      ? (codex as { error?: unknown }).error
      : undefined
  const fields = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : undefined
  return {
    message: typeof fields?.message === "string" ? fields.message : "Turn failed",
    category: typeof fields?.category === "string" ? fields.category : null,
    retryable: fields?.retryable === true
  }
}
