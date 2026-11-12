import type { CustomProvider, ProviderSnapshot } from "@alwith/module-chat/settings"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { enterpriseCatalog, projectEnterpriseProviders } from "@/features/auth/enterprise-providers"
import { usePlatformAuth } from "@/features/auth/store"

import i18n from "./i18n"
import { createCatalogSource } from "./model-catalog-state"
import { providersPort } from "./providers"
import { text } from "./text"

/** Each mounted consumer owns subscriptions scoped to its current login identity. */
export function useModelCatalog() {
  const { t } = useTranslation()
  const account = usePlatformAuth((state) => state.user)
  const sources = useMemo(() => {
    const shared = createCatalogSource<ProviderSnapshot>()
    const enterprise = createCatalogSource<CustomProvider | null>()
    shared.reset(account)
    enterprise.reset(account)
    return { shared, enterprise }
  }, [account])
  const shared = useSyncExternalStore(sources.shared.subscribe, sources.shared.getSnapshot)
  const enterprise = useSyncExternalStore(sources.enterprise.subscribe, sources.enterprise.getSnapshot)
  useEffect(() => {
    let active = true
    const refreshShared = () => {
      void sources.shared
        .refresh(() => providersPort.read())
        .catch((error) => {
          if (active) toast.error(text(error))
        })
    }
    const refreshEnterprise = () => {
      void sources.enterprise
        .refresh(async () => enterpriseCatalog(await commands.enterpriseCatalog()))
        .catch((error) => {
          if (active) {
            console.error("Enterprise model catalog refresh failed", error)
            toast.error(i18n.t("provider.catalogUpdateFailed"))
          }
        })
    }
    const sharedListener = providersPort.onChanged(() => refreshShared())
    const enterpriseListener = listen("enterprise:models-changed", refreshEnterprise)
    // Subscribe before reading. Source revisions prevent a late initial read from
    // replacing a subsequent event, independently for each catalog.
    void sharedListener
      .then(() => {
        if (active) refreshShared()
      })
      .catch((error) => {
        if (active) {
          toast.error(text(error))
          refreshShared()
        }
      })
    void enterpriseListener
      .then(() => {
        if (active) refreshEnterprise()
      })
      .catch((error) => {
        if (active) {
          toast.error(`Enterprise: ${text(error)}`)
          refreshEnterprise()
        }
      })
    return () => {
      active = false
      sources.shared.reset(null)
      sources.enterprise.reset(null)
      for (const listener of [sharedListener, enterpriseListener]) {
        void listener
          .then((stop) => stop())
          .catch((error) => console.error("Catalog subscription cleanup failed", error))
      }
    }
  }, [sources])
  // This projection is for model-menu compatibility only. The source states above
  // retain their own authority, revision and errors; resolution never uses this view.
  const base =
    shared.data ??
    (enterprise.data !== null
      ? ({
          revision: 0,
          appliedRevision: null,
          status: "loading",
          error: null,
          providers: {},
          customProviders: []
        } satisfies ProviderSnapshot)
      : null)
  const snapshot =
    base === null
      ? null
      : projectEnterpriseProviders(
          base,
          enterprise.data === null
            ? null
            : {
                ...enterprise.data,
                name:
                  enterprise.status === "error"
                    ? `${enterprise.data.name} (${t("provider.catalogUnconfirmed")})`
                    : enterprise.data.name
              }
        )
  return { shared, enterprise, snapshot }
}
