import { ArchiveIcon, LayoutGridIcon, PawPrintIcon } from "lucide-react"
import type { ReactElement, ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function LeadingNavigation({
  activePage,
  onOpenVibemon,
  onOpenPlugins,
  onOpenArchives,
  children
}: {
  activePage: "vibemon" | "plugins" | "extensions" | "archives" | null
  children?: ReactNode
  onOpenVibemon: () => void
  onOpenPlugins: () => void
  onOpenArchives: () => void
}): ReactElement {
  const { t } = useTranslation()
  const items = [
    { id: "vibemon", label: t("sidebar.pets"), icon: PawPrintIcon, onClick: onOpenVibemon },
    { id: "plugins", label: t("plugins.catalog.customize"), icon: LayoutGridIcon, onClick: onOpenPlugins },
    { id: "archives", label: t("archives.title"), icon: ArchiveIcon, onClick: onOpenArchives }
  ] as const

  return (
    <nav aria-label={t("sidebar.leadingNavigation")} className="leading-navigation">
      {items.map(({ id, label, icon: Icon, onClick }) => {
        const button = (
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-current={activePage === id || (id === "plugins" && activePage === "extensions") ? "page" : undefined}
            onClick={onClick}
            className="size-9 rounded-[10px] text-muted-foreground hover:text-foreground aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground motion-reduce:transition-none"
          >
            <Icon aria-hidden="true" className="size-[18px]" />
          </Button>
        )
        return (
          <Tooltip key={id}>
            <TooltipTrigger render={button} />
            <TooltipContent side="inline-end">{label}</TooltipContent>
          </Tooltip>
        )
      })}
      {children}
    </nav>
  )
}
