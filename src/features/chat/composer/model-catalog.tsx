import type { ModelMenuProps } from "@alwith/module-chat/conversation"
import type { ChatModelOption } from "@alwith/module-chat/model-select"
import { Bot } from "lucide-react"

import { NATIVE_MODEL_GROUP } from "@/agent/client"
import openaiLogo from "@/components/icons/openai-logo.svg"
import modelPresentation from "@/lib/model-presentation.json"
import providerCatalog from "@/lib/provider-catalog.json"
import { gatewayModelId, PROVIDERS } from "@/lib/providers"

import alwithLogo from "../../../../src-tauri/icons/32x32.png"
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

const presentation: Record<string, { shortLabel: string } | undefined> = modelPresentation

/** Short labels affect only the selected trigger; catalog labels remain authoritative. */
export function modelTriggerLabel(model: ModelOption): string {
  return model.shortLabel ?? model.label
}

/** Put the subscription provider first while preserving provider and model order. */
export function presentModelCatalog(groups: ModelGroup[]): ModelGroup[] {
  const ordered = [
    ...groups.filter((group) => group.id === NATIVE_MODEL_GROUP.id),
    ...groups.filter((group) => group.id !== NATIVE_MODEL_GROUP.id)
  ]
  return ordered.map((group) => {
    const native = group.id === NATIVE_MODEL_GROUP.id
    const Logo = PROVIDERS.find((provider) => provider.id === group.id)?.logo ?? Bot
    return {
      ...group,
      models: group.models.map((model) => ({
        ...model,
        label: managedLabels.get(model.api_id) ?? model.label,
        shortLabel: model.shortLabel ?? presentation[model.api_id]?.shortLabel,
        icon: native ? (
          <img src={openaiLogo} alt="" className="size-4 shrink-0 dark:invert" />
        ) : group.id === "litellm" ? (
          <img src={alwithLogo} alt="" className="size-4 shrink-0" />
        ) : (
          <Logo aria-hidden="true" className="size-4 shrink-0" />
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
