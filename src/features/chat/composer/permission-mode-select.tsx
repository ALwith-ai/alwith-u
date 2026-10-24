/**
 * Permission mode: the config option in category `mode`. Items and the current value come
 * from the agent's `config_option_update`; icons are the desktop visual layer keyed by the
 * option value. From ALwith Desktop.
 */
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isGroupedSelect, isSelectOption, type SelectOption } from "@alwith/api"
import { PermissionModeSelect as SharedPermissionModeSelect } from "@alwith/module-chat/permission-mode-select"
import { createLucideIcon, HandIcon, type LucideIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { client } from "@/lib/client"

const ApprovalShieldIcon = createLucideIcon("ApprovalShield", [
  ["path", { d: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11", key: "shield" }],
  ["path", { d: "m8 8 3 3-3 3M13 15h3", key: "terminal" }]
])

const MODE_ICONS: Record<string, LucideIcon> = {
  "read-only": HandIcon,
  "workspace-write": ShieldCheckIcon,
  agent: ApprovalShieldIcon,
  "agent-full-access": ShieldAlertIcon
}

const MODE_TRANSLATION_KEYS: Record<string, string> = {
  "read-only": "readOnly",
  "workspace-write": "workspaceAccess",
  agent: "agent",
  "agent-full-access": "fullAccess"
}

function modeConfigOption(options: acp.SessionConfigOption[]): SelectOption | undefined {
  return options.find((option) => option.category === "mode" && isSelectOption(option)) as SelectOption | undefined
}

export function flattenSelectOptions(option: SelectOption): acp.SessionConfigSelectOption[] {
  return isGroupedSelect(option.options) ? option.options.flatMap((group) => group.options) : option.options
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
  const availableModes = flattenSelectOptions(modeOption).map((mode) => {
    const key = MODE_TRANSLATION_KEYS[mode.value]
    return key
      ? {
          ...mode,
          name: t(`chat.permissionModes.${key}.name`),
          description: t(`chat.permissionModes.${key}.description`)
        }
      : mode
  })
  const current = availableModes.find((option) => option.value === currentModeId)
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
      icon={<CurrentIcon className="size-3.5 shrink-0" />}
      header={t("chat.permissionModes.heading")}
      disabled={disabled}
      label={t("chat.model.switchPermissionMode")}
      onValueChange={change}
      options={availableModes.map((mode) => {
        const Icon = MODE_ICONS[mode.value] ?? ShieldCheckIcon
        const warning = mode.value === "agent-full-access"
        return {
          value: mode.value,
          label: <span data-permission-warning={warning ? "" : undefined}>{mode.name}</span>,
          description: mode.description ? <span className="whitespace-normal">{mode.description}</span> : undefined,
          icon: <Icon className="size-3.5 shrink-0" />
        }
      })}
    />
  )
}
