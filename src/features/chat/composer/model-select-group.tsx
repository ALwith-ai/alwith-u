import { ModelSelect, type ChatModelOption } from "@alwith/module-chat/model-select"
/**
 * The model menu: model list, reasoning effort slider, other model settings (selects as
 * radio sections, booleans as switches). Everything is data-driven from the agent's
 * `config_option_update` by category: `model`, `thought_level`, `model_config`. From ALwith
 * Desktop's select-model / model-select-group, without providers.
 */
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { type BooleanOption, isBooleanOption, isGroupedSelect, isSelectOption, type SelectOption } from "@alwith/api"
import { client } from "@/lib/client"
import { flattenSelectOptions } from "./permission-mode-select"

function currentName(option: SelectOption): string {
  return flattenSelectOptions(option).find(item => item.value === option.currentValue)?.name ?? option.currentValue
}

export function ModelSelectGroup({
  sessionId,
  options,
  disabled
}: {
  sessionId: string
  options: acp.SessionConfigOption[]
  disabled: boolean
}) {
  const { t } = useTranslation()
  const model = options.find(option => option.category === "model" && isSelectOption(option)) as
    SelectOption | undefined
  const effort = options.find(option => option.category === "thought_level" && isSelectOption(option)) as
    SelectOption | undefined
  const others = options.filter(
    option =>
      option.category === "model_config" || (option.category !== "mode" && option !== model && option !== effort)
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
    label: item.name,
    description: item.description ?? undefined
  })
  const models = model ? flattenSelectOptions(model).map(toModel) : []
  return (
    <ModelSelect
      disabled={disabled}
      value={{ api_id: model?.currentValue ?? "", label }}
      models={models}
      showModelList={Boolean(model)}
      showDescription
      onChange={item => {
        if (model) set(model, item.api_id)
      }}
      header={model ? { name: model.name } : undefined}
      modelGroups={
        model && isGroupedSelect(model.options)
          ? model.options.map(group => ({ id: group.groupId, name: group.name, models: group.options.map(toModel) }))
          : undefined
      }
      t={key => t(key, { ns: "alwithChat" })}
      effortConfig={
        effort && effortLevels.length > 0
          ? {
              name: effort.name,
              value: effort.currentValue,
              levels: effortLevels,
              sizer: effortSizer,
              onChange: value => set(effort, value)
            }
          : undefined
      }
      selectOptions={selects.map(option => ({
        id: option.configId,
        name: option.name,
        value: option.currentValue,
        options: flattenSelectOptions(option).map(item => ({
          value: item.value,
          label: item.name,
          description: item.description ?? undefined
        })),
        onChange: value => set(option, value)
      }))}
      booleanOptions={booleans.map(option => ({
        id: option.configId,
        name: option.name,
        currentValue: option.currentValue
      }))}
      onBooleanChange={(id, value) => {
        const option = booleans.find(option => option.configId === id)
        if (!option) throw new Error(`Unknown boolean config: ${id}`)
        set(option, value)
      }}
    />
  )
}
