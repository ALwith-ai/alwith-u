import { listen } from "@tauri-apps/api/event"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { toast } from "sonner"

import { commands } from "@/bindings"
import i18n from "@/lib/i18n"

import { createEnterpriseEventHandler } from "./enterprise-events"
import { createManagedProviders } from "./managed-providers"
import { createProviderRefreshClient, serveProviderRefresh } from "./provider-refresh-bridge"

interface EnterpriseModelsHost {
  apiBaseUrl: string
  account(): string | null
  validate(userUuid: string): Promise<void>
  authenticated(action: (accessToken: string) => Promise<void>): Promise<void>
  refreshProfile(): Promise<unknown>
}

export function createEnterpriseModels(host: EnterpriseModelsHost) {
  const bindings = new Map<number, { account: { apiBaseUrl: string; userUuid: string }; generation: number }>()
  const providers = createManagedProviders({
    validate: host.validate,
    bind: async (userUuid) => {
      const account = { apiBaseUrl: host.apiBaseUrl, userUuid }
      const generation = await commands.enterpriseBind({ account })
      bindings.set(generation, { account, generation })
      return generation
    },
    refresh: async (generation) => {
      const binding = bindings.get(generation)
      if (!binding) throw new Error("Enterprise account binding is missing")
      await host.authenticated(async (accessToken) => {
        await commands.enterpriseRefresh({ ...binding, accessToken })
      })
    },
    clear: async () => {
      bindings.clear()
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
    account: host.account,
    status: () => commands.enterpriseStatus(),
    renewAccount: async (generation, requestId) => {
      await host.refreshProfile()
      await host.authenticated(async (accessToken) => {
        await commands.enterpriseUpdateAccount({ generation, requestId, accessToken })
      })
    },
    refreshModels: refresh,
    failed
  })
  return {
    confirm: providers.confirm,
    clear: providers.clear,
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

let requestEnterpriseRefresh: (() => Promise<void>) | undefined
export function requestEnterpriseProviderRefresh(): Promise<void> {
  requestEnterpriseRefresh ??= createProviderRefreshClient(getCurrentWebviewWindow().label, undefined, "enterprise")
  return requestEnterpriseRefresh()
}
