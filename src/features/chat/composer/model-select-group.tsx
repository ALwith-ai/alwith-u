/**
 * The model menu: model list, reasoning effort slider, other model settings (selects as
 * radio sections, booleans as switches). Everything is data-driven from the agent's
 * `config_option_update` by category: `model`, `thought_level`, `model_config`. From ALwith
 * Desktop's shared model-select, with host-owned catalog policy.
 */
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { type BooleanOption, isBooleanOption, isGroupedSelect, isSelectOption, type SelectOption } from "@alwith/api"
import { type ChatModelOption, ModelSelect } from "@alwith/module-chat/model-select"
import { Zap } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { NATIVE_MODEL_GROUP } from "@/agent/client"
import { client, useApp } from "@/lib/client"

import { modelTriggerLabel, presentModelCatalog } from "./model-catalog"
import { ModelSettingsAction } from "./model-settings-action"
import { flattenSelectOptions } from "./permission-mode-select"

function currentName(option: SelectOption): string {
  return flattenSelectOptions(option).find((item) => item.value === option.currentValue)?.name ?? option.currentValue
}

export function ModelSelectGroup({
  sessionId,
  options,
  disabled,
  onModelChange
}: {
  sessionId: string
  options: acp.SessionConfigOption[]
  disabled: boolean
  /** Unsent drafts create a replacement session directly on the chosen model. */
  onModelChange?: (model: string) => void
}) {
  const { t } = useTranslation()
  const switching = useApp((state) => Boolean(state.configPending[sessionId]))
  const model = options.find((option) => option.category === "model" && isSelectOption(option)) as
    SelectOption | undefined
  const effort = options.find((option) => option.category === "thought_level" && isSelectOption(option)) as
    SelectOption | undefined
  const others = options.filter(
    (option) =>
      option.configId !== "collaboration_mode" &&
      (option.category === "model_config" || (option.category !== "mode" && option !== model && option !== effort))
  )
  const selects = others.filter(isSelectOption)
  const booleans: BooleanOption[] = others.filter(isBooleanOption)
  if (!model && !effort && selects.length === 0 && booleans.length === 0) return null

  const set = (option: acp.SessionConfigOption, value: string | boolean) => {
    if (value === option.currentValue) return
    client.setConfig(sessionId, option.configId, value).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }
  const effortLevels = effort ? flattenSelectOptions(effort) : []
  const effortSizer = effortLevels.reduce((a, b) => (b.name.length >= a.length ? b.name : a), "")
  const label = model ? currentName(model) : t("chat.model.model")

  const toModel = (item: acp.SessionConfigSelectOption): ChatModelOption => ({
    api_id: item.value,
    label: item.name
  })
  const groups = presentModelCatalog(
    model && isGroupedSelect(model.options)
      ? model.options.map((group) => ({
          id: group.groupId,
          name: group.name,
          models: group.options.map(toModel)
        }))
      : [
          {
            ...NATIVE_MODEL_GROUP,
            models: model ? flattenSelectOptions(model).map(toModel) : []
          }
        ],
    model?.currentValue ?? ""
  )
  const models = groups.flatMap((group) => group.models)
  // The compact menu renders a flat list. Keep each provider's primary choices
  // ahead of the native catalog's overflow so configured gateways are discoverable.
  if (groups.some((group) => group.id !== NATIVE_MODEL_GROUP.id && group.models.length > 0))
    models.sort((a, b) => Number(a.more) - Number(b.more))
  const selected = models.find((item) => item.api_id === model?.currentValue) ?? {
    api_id: model?.currentValue ?? "",
    label
  }
  const fast = booleans.find((option) => option.configId === "fast-mode")
  return (
    <ModelSelect
      disabled={disabled || switching}
      switching={switching}
      value={{ ...selected, label: modelTriggerLabel(selected) }}
      compactCatalog
      unavailableEffort={{
        name: "Effort",
        label: t("chat.model.unsupported")
      }}
      models={models}
      showModelList={Boolean(model)}
      onChange={(item) => {
        if (item.api_id === model?.currentValue) return
        if (onModelChange) onModelChange(item.api_id)
        else if (model) set(model, item.api_id)
      }}
      header={{ name: model?.name ?? t("chat.model.model"), action: <ModelSettingsAction /> }}
      modelGroups={groups}
      t={(key) => t(key, { ns: "alwithChat" })}
      effortConfig={
        effort && effortLevels.length > 0
          ? {
              name: "Effort",
              value: effort.currentValue,
              levels: effortLevels,
              sizer: effortSizer,
              onChange: (value) => set(effort, value)
            }
          : undefined
      }
      selectOptions={selects.map((option) => ({
        id: option.configId,
        name: option.name,
        value: option.currentValue,
        options: flattenSelectOptions(option).map((item) => ({
          value: item.value,
          label: item.name
        })),
        onChange: (value) => set(option, value)
      }))}
      booleanOptions={[
        {
          id: "fast-mode",
          name: t("chat.model.fastMode"),
          currentValue: fast?.currentValue ?? false,
          disabled: !fast,
          title: !fast ? t("chat.model.unsupportedHint") : undefined,
          icon: <Zap className="size-4" aria-hidden="true" />
        },
        ...booleans
          .filter((option) => option !== fast)
          .map((option) => ({
            id: option.configId,
            name: option.name,
            currentValue: option.currentValue
          }))
      ]}
      onBooleanChange={(id, value) => {
        const option = booleans.find((option) => option.configId === id)
        if (!option) throw new Error(`Unknown boolean config: ${id}`)
        set(option, value)
      }}
    />
  )
}
