import type { ChatModelOption } from "@alwith/module-chat/model-select"
import { Bot } from "lucide-react"

import { NATIVE_MODEL_GROUP } from "@/agent/client"
import openaiLogo from "@/components/icons/openai-logo.svg"
import { PROVIDERS } from "@/lib/providers"

type ModelGroup = { id: string; name: string; models: ChatModelOption[] }

/** Compact composer labels without changing the full catalog names. */
export function modelTriggerLabel(label: string): string {
  if (/^deepseek[- ]flash$/i.test(label)) return "flash"
  return label.replace(/^GPT[- ](?=\d)/i, "")
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
        label: group.id === "qwen" && !/^qwen\b/i.test(model.label) ? `Qwen ${model.label}` : model.label,
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
