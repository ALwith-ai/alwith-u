import { createManagedProvidersPort } from "@alwith/module-chat/settings"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { toast } from "sonner"

import { createManagedProviders } from "./managed-providers"
import { createProviderRefreshClient, serveProviderRefresh } from "./provider-refresh-bridge"

interface AlwithModelsHost {
  apiBaseUrl: string
  account(): string | null
  validate(userUuid: string): Promise<void>
  authenticated(action: (accessToken: string) => Promise<void>): Promise<void>
}

export function createAlwithModels(host: AlwithModelsHost) {
  const port = createManagedProvidersPort()
  const providers = createManagedProviders({
    validate: host.validate,
    bind: (userUuid) => port.bind({ apiBaseUrl: host.apiBaseUrl, userUuid }),
    refresh: (generation) =>
      host.authenticated(async (accessToken) => {
        await port.refresh(generation, accessToken)
      }),
    clear: () => port.clear()
  })
  async function refresh(): Promise<void> {
    if (getCurrentWebviewWindow().label !== "main") throw new Error("ALwith model refresh belongs to the main window")
    const user = host.account()
    if (!user) throw new Error("Sign in to refresh ALwith models")
    await providers.refresh(user)
  }
  return {
    confirm: providers.confirm,
    clear: providers.clear,
    refresh,
    refreshInBackground(): void {
      void refresh().catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "object" && error !== null && "message" in error
              ? String(error.message)
              : String(error)
        toast.error(message)
      })
    },
    async init(): Promise<void> {
      await serveProviderRefresh(refresh)
    }
  }
}

let requestProviderRefresh: (() => Promise<void>) | undefined
export function requestAccountProviderRefresh(): Promise<void> {
  requestProviderRefresh ??= createProviderRefreshClient(getCurrentWebviewWindow().label)
  return requestProviderRefresh()
}
