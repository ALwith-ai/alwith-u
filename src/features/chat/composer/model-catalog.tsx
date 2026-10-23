import type { ChatModelOption } from "@alwith/module-chat/model-select"
import { Bot } from "lucide-react"

import { NATIVE_MODEL_GROUP } from "@/agent/client"
import openaiLogo from "@/components/icons/openai-logo.svg"
import modelPresentation from "@/lib/model-presentation.json"
import { PROVIDERS } from "@/lib/providers"

type ModelOption = ChatModelOption & { shortLabel?: string }
type ModelGroup = { id: string; name: string; models: ModelOption[] }

const presentation: Record<string, { shortLabel: string } | undefined> = modelPresentation

/** Short labels affect only the selected trigger; catalog labels remain authoritative. */
export function modelTriggerLabel(model: ModelOption): string {
  return model.shortLabel ?? model.label
}

/** Preserve catalog order and reserve the last primary slot for the active model. */
export function presentModelCatalog(groups: ModelGroup[], selected: string): ModelGroup[] {
  const hasGateways = groups.some((group) => group.id !== NATIVE_MODEL_GROUP.id && group.models.length > 0)
  return groups.map((group) => {
    const native = group.id === NATIVE_MODEL_GROUP.id
    const limit = native ? (hasGateways ? 3 : 4) : 1
    const primary = group.models.slice(0, limit).map((model) => model.api_id)
    if (group.models.some((model) => model.api_id === selected) && !primary.includes(selected)) {
      primary[primary.length - 1] = selected
    }
    const Logo = PROVIDERS.find((provider) => provider.id === group.id)?.logo ?? Bot
    return {
      ...group,
      models: group.models.map((model) => ({
        ...model,
        shortLabel: model.shortLabel ?? presentation[model.api_id]?.shortLabel,
        icon: native ? (
          <img src={openaiLogo} alt="" className="size-4 shrink-0 dark:invert" />
        ) : (
          <Logo aria-hidden="true" className="size-4 shrink-0" />
        ),
        more: !primary.includes(model.api_id)
      }))
    }
  })
}
