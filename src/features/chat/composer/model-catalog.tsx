import providerCatalog from "@alwith/module-chat/assets/provider-catalog.json"
import type { ModelMenuProps } from "@alwith/module-chat/conversation"
import type { ChatModelOption } from "@alwith/module-chat/model-select"

import { NATIVE_MODEL_GROUP } from "@/agent/client"
import { ModelIcon } from "@/components/icons/model-icon"
import { isEnterpriseModel } from "@/features/auth/enterprise-providers"
import { gatewayModelId, isAccountModel, MODEL_PRESENTATION } from "@/lib/providers"

import { ModelSettingsAction } from "./model-settings-action"

type ModelOption = ChatModelOption & { shortLabel?: string }
type ModelGroup = { id: string; name: string; models: ModelOption[] }

const managedLabels = new Map(
  providerCatalog
    .filter((provider) => provider.source === "account")
    .flatMap((provider) =>
      provider.models.map((model) => [gatewayModelId(provider.id, model.id), model.label] as const)
    )
)

const presentation = MODEL_PRESENTATION
const groupPriorities = new Map<string, number>([
  ...providerCatalog.map((provider): [string, number] => [provider.id, provider.source === "account" ? 1 : 2]),
  [NATIVE_MODEL_GROUP.id, 0]
])

/** Short labels affect only the selected trigger; catalog labels remain authoritative. */
export function modelTriggerLabel(model: ModelOption): string {
  return model.shortLabel ?? model.label
}

/** Order subscription, account, built-in and custom groups; preserve order within each tier. */
export function presentModelCatalog(groups: ModelGroup[]): ModelGroup[] {
  const ordered = groups.toSorted((a, b) => (groupPriorities.get(a.id) ?? 3) - (groupPriorities.get(b.id) ?? 3))
  return ordered.map((group) => {
    const native = group.id === NATIVE_MODEL_GROUP.id
    return {
      ...group,
      models: group.models.map((model) => ({
        ...model,
        label: managedLabels.get(model.api_id) ?? model.label,
        shortLabel: model.shortLabel ?? presentation[model.api_id]?.shortLabel,
        icon: (
          <ModelIcon
            provider={
              native
                ? "chatgpt"
                : group.id === "finture-enterprise" || isEnterpriseModel(model.api_id)
                  ? "alwith-enterprise"
                  : group.id === "litellm" || group.id === "alwith-managed-litellm" || isAccountModel(model.api_id)
                    ? "alwith-account"
                    : group.id
            }
          />
        )
      }))
    }
  })
}

/** U's model menu policy: subscription models first, provider logos, short labels, settings action. */
export const chatModelMenu: Pick<ModelMenuProps, "catalog" | "defaultGroup" | "headerAction"> = {
  defaultGroup: NATIVE_MODEL_GROUP,
  catalog: presentModelCatalog,
  headerAction: <ModelSettingsAction />
}
