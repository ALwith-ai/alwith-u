/**
 * Permission mode: the config option in category `mode`. Items and the current value come
 * from the agent's `config_option_update`; icons are the desktop visual layer keyed by the
 * option value. From ALwith Desktop.
 */
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { CodeXmlIcon, EyeIcon, type LucideIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { PermissionModeSelect as SharedPermissionModeSelect } from "@alwith/chat/permission-mode-select"
import { isGroupedSelect, isSelectOption, type SelectOption } from "@alwith/api"
import { client } from "@/lib/client"

const MODE_ICONS: Record<string, LucideIcon> = {
  "read-only": EyeIcon,
  agent: CodeXmlIcon,
  "agent-full-access": TriangleAlertIcon
}

export function modeConfigOption(options: acp.SessionConfigOption[]): SelectOption | undefined {
  return options.find(option => option.category === "mode" && isSelectOption(option)) as SelectOption | undefined
}

export function flattenSelectOptions(option: SelectOption): acp.SessionConfigSelectOption[] {
  return isGroupedSelect(option.options) ? option.options.flatMap(group => group.options) : option.options
}

export function PermissionModeSelect({
  sessionId,
  options,
  disabled
}: {
  sessionId: string
  options: acp.SessionConfigOption[]
  disabled: boolean
}) {
  const { t } = useTranslation()
  const modeOption = modeConfigOption(options)
  if (!modeOption) return null
  const currentModeId = modeOption.currentValue
  const availableModes = flattenSelectOptions(modeOption)
  const current = availableModes.find(option => option.value === currentModeId)
  const currentModeName = current?.name ?? currentModeId
  const CurrentIcon = MODE_ICONS[currentModeId] ?? ShieldCheckIcon
  const change = (value: string) => {
    if (value === currentModeId) return
    client.setConfig(sessionId, modeOption.configId, value).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }
  return (
    <SharedPermissionModeSelect
      value={currentModeId}
      currentName={currentModeName}
      icon={<CurrentIcon className="size-4 shrink-0" />}
      disabled={disabled}
      label={t("chat.model.switchPermissionMode")}
      onValueChange={change}
      options={availableModes.map(mode => {
        const Icon = MODE_ICONS[mode.value] ?? ShieldCheckIcon
        return {
          value: mode.value,
          label: mode.name,
          description: mode.description ?? undefined,
          icon: <Icon className="size-4 shrink-0" />
        }
      })}
    />
  )
}
