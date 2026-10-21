import type { ExtensionManifest } from "@alwith/module-extension"
import type { HostSnapshot } from "@alwith/module-extension/host"
import { resolveActionTarget } from "@alwith/module-extension/host"
import { SettingsIcon } from "lucide-react"
import { cloneElement, type ReactElement } from "react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

import { extensionApps } from "./extension-apps"
import { EXTENSION_ICONS } from "./extension-icons"

export function ExtensionEntryMenu({
  host,
  manifests,
  trigger,
  onManage,
  onOpenSurface,
  onError
}: {
  manifests: ExtensionManifest[]
  host: HostSnapshot
  trigger: ReactElement<{ onClick?: () => void }>
  onManage: () => void
  onOpenSurface: (id: string) => void
  onError: (error: unknown) => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const apps = extensionApps(host, manifests, i18n.language)
  if (!apps.length) return trigger
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={cloneElement(trigger, { onClick: undefined })} />
      <DropdownMenuContent side="bottom" align="start" sideOffset={8} className="w-60">
        {apps.map(({ action, name }) => {
          const target = resolveActionTarget(host, action)
          const Icon = EXTENSION_ICONS[action.icon ?? "blocks"]
          return (
            <DropdownMenuItem
              key={action.id}
              className="h-8 py-0"
              disabled={!target}
              onClick={() => {
                void Promise.resolve()
                  .then(() => {
                    if (target?.type === "command") return target.command.run()
                    if (target?.type === "surface") return onOpenSurface(target.view.id)
                    throw new Error(`Extension action target unavailable: ${action.target.id}`)
                  })
                  .catch(onError)
              }}
            >
              <Icon className="text-muted-foreground" />
              <span className="min-w-0 truncate">{name}</span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-8 py-0" onClick={onManage}>
          <SettingsIcon className="text-muted-foreground" />
          {t("extensions.manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
