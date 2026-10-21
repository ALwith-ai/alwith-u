import type { ExtensionManifest } from "@alwith/module-extension"
import { type HostSnapshot, resolveActionTarget } from "@alwith/module-extension/host"
import type { ReactElement } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { extensionApps } from "./extension-apps"
import { EXTENSION_ICONS } from "./extension-icons"

export function ExtensionNavigation({
  host,
  manifests,
  activeView,
  onOpenSurface,
  onError
}: {
  host: HostSnapshot
  manifests: ExtensionManifest[]
  activeView?: string | null
  onOpenSurface: (id: string) => void
  onError: (error: unknown) => void
}): ReactElement | null {
  const { t, i18n } = useTranslation()
  const apps = extensionApps(host, manifests, i18n.language)
  if (!apps.length) return null
  return (
    <>
      <div className="w-6 shrink-0">
        <Separator className="h-px bg-[var(--chrome-hover-background)]" />
      </div>
      <section
        aria-label={t("extensions.outlets.navigation")}
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-1"
      >
        {apps.map(({ action, name }) => {
          const target = resolveActionTarget(host, action)
          const active = host.views.some((view) => view.id === activeView && view.extensionId === action.extensionId)
          const Icon = EXTENSION_ICONS[action.icon ?? "blocks"]
          return (
            <Tooltip key={action.extensionId}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={name}
                    aria-current={active ? "page" : undefined}
                    disabled={!target}
                    className="size-9 rounded-[10px] text-muted-foreground hover:text-foreground aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground motion-reduce:transition-none"
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
                    <Icon aria-hidden="true" className="size-[18px]" />
                  </Button>
                }
              />
              <TooltipContent side="inline-end">
                {target ? name : t("extensions.targetUnavailable", { name })}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </section>
    </>
  )
}
