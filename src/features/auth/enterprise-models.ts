import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { toast } from "sonner"

import { type Account, commands } from "@/bindings"
import i18n from "@/lib/i18n"

import { createEnterpriseEventHandler } from "./enterprise-events"
import { createManagedProviders } from "./managed-providers"
import { serveProviderRefresh } from "./provider-refresh-bridge"

interface EnterpriseModelsHost {
  environment: "production" | "development"
  account(): string | null
  email(): string | null
  labels(): Promise<Record<string, string> | null>
}

/** Read presentation metadata only; gateway discovery still owns model availability. */
export function enterpriseModelLabels(value: unknown): Record<string, string> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("provider_id" in value) ||
    value.provider_id !== "finture-enterprise" ||
    !("models" in value) ||
    !Array.isArray(value.models)
  )
    throw new Error("Invalid enterprise provider presentation metadata")
  const entries = value.models.map((model: unknown): [string, string] => {
    if (
      typeof model !== "object" ||
      model === null ||
      !("api_id" in model) ||
      typeof model.api_id !== "string" ||
      !model.api_id.trim() ||
      !("label" in model) ||
      typeof model.label !== "string" ||
      !model.label.trim()
    )
      throw new Error("Invalid enterprise model label")
    return [model.api_id, model.label]
  })
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error("Duplicate enterprise model labels")
  return Object.fromEntries(entries)
}

export function createEnterpriseModels(host: EnterpriseModelsHost) {
  const bindings = new Map<number, { account: Account; generation: number }>()
  const labelsByAccount = new Map<string, Record<string, string>>()
  function current(account: Account): void {
    if (host.account() !== account.userUuid || host.email() !== account.email)
      throw new Error("ALwith account changed during enterprise preparation")
  }
  const providers = createManagedProviders({
    validate: async () => {},
    bind: async (userUuid) => {
      const email = host.email()
      if (!email?.trim()) throw new Error("ALwith account email is missing")
      const account = { environment: host.environment, userUuid, email }
      current(account)
      const generation = await commands.enterpriseBind({ account })
      current(account)
      bindings.set(generation, { account, generation })
      return generation
    },
    refresh: async (generation) => {
      const binding = bindings.get(generation)
      if (!binding) throw new Error("Enterprise account binding is missing")
      current(binding.account)
      const labels = await host.labels()
      current(binding.account)
      const owner = JSON.stringify(binding.account)
      if (labels !== null) labelsByAccount.set(owner, labels)
      await commands.enterpriseRefresh({ ...binding, modelLabels: labelsByAccount.get(owner) ?? {} })
      current(binding.account)
    },
    clear: async () => {
      bindings.clear()
      labelsByAccount.clear()
      await commands.enterpriseClear()
    }
  })
  async function refresh(): Promise<void> {
    if (getCurrentWebviewWindow().label !== "main")
      throw new Error("Enterprise model refresh belongs to the main window")
    const user = host.account()
    if (!user) throw new Error("Sign in to refresh enterprise models")
    await providers.refresh(user)
  }
  const failed = (): void => {
    toast.error(i18n.t("enterprise.error"))
  }
  const handleEvent = createEnterpriseEventHandler({
    account: () => host.account(),
    status: () => commands.enterpriseStatus(),
    refreshModels: refresh,
    failed
  })
  return {
    confirm: providers.confirm.bind(providers),
    clear: providers.clear.bind(providers),
    refresh,
    refreshInBackground(): void {
      void refresh().catch(failed)
    },
    async init(): Promise<void> {
      await listen<unknown>("enterprise:event", ({ payload }) => {
        void handleEvent(payload)
      })
      await serveProviderRefresh(refresh, undefined, "enterprise")
    }
  }
}
