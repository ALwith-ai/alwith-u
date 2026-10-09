import { type ChatModelOption, ModelSelect } from "@alwith/module-chat/model-select"
import { useTranslation } from "react-i18next"
import { NATIVE_MODEL_GROUP } from "@/agent/client"
import type { ProviderSnapshot } from "@/lib/providers"
import { gatewayModelId, providerGroups } from "@/lib/providers"

const nativeModel: ChatModelOption = { api_id: "", label: NATIVE_MODEL_GROUP.name }

/** Native model details arrive with session/new; gateway models are already in the catalog. */
export function DraftModelSelect({
  snapshot,
  model,
  onChange
}: {
  snapshot: ProviderSnapshot | null
  model: string | null
  onChange: (model: string | null) => void
}) {
  const { t } = useTranslation()
  const groups: { id: string; name: string; models: ChatModelOption[] }[] = [
    { id: NATIVE_MODEL_GROUP.id, name: NATIVE_MODEL_GROUP.name, models: [nativeModel] },
    ...(snapshot === null ? [] : providerGroups(snapshot)).map(provider => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.map(item => ({
        api_id: gatewayModelId(provider.id, item.id),
        label: item.label ?? item.id
      }))
    }))
  ]
  const models = groups.flatMap(group => group.models)
  const selected =
    model === null ? nativeModel : (models.find(item => item.api_id === model) ?? { api_id: model, label: model })
  return (
    <ModelSelect
      value={selected}
      models={models}
      modelGroups={groups}
      showModelList
      showDescription
      onChange={item => onChange(item.api_id === "" ? null : item.api_id)}
      t={key => t(key, { ns: "alwithChat" })}
    />
  )
}
