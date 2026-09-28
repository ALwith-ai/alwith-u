import type { ActionPlacement, ContributionIcon, ContributionAlignment } from "@alwith/module-extension"
import type { HostSnapshot, ViewContribution, ActionContribution } from "@alwith/module-extension/host"
import { resolveActionTarget, sortContributions } from "@alwith/module-extension/host"
import {
  BlocksIcon,
  ChartNoAxesColumnIcon,
  ClockIcon,
  GlobeIcon,
  PanelsTopLeftIcon,
  PlayIcon,
  SettingsIcon
} from "lucide-react"
import type { ReactElement, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { MENU_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { NavigationItemButton } from "@/features/layout/components/navigation/navigation-item"

const ICONS: Record<ContributionIcon, typeof BlocksIcon> = {
  blocks: BlocksIcon,
  play: PlayIcon,
  panel: PanelsTopLeftIcon,
  settings: SettingsIcon,
  clock: ClockIcon,
  chart: ChartNoAxesColumnIcon,
  globe: GlobeIcon
}
const ALIGNMENTS = ["left", "center", "right"] as const
const ALIGNMENT_CLASSES: Record<ContributionAlignment, string> = {
  left: "justify-self-start",
  center: "justify-self-center",
  right: "justify-self-end"
}
function BarGroup({ alignment, children }: { alignment: ContributionAlignment; children: ReactNode }): ReactElement {
  return (
    <div
      data-extension-alignment={alignment}
      className={`pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-x-auto ${ALIGNMENT_CLASSES[alignment]}`}>
      {children}
    </div>
  )
}

export function ExtensionActions({
  host,
  placement,
  activeView,
  onOpenSurface,
  onError
}: {
  host: HostSnapshot
  placement: ActionPlacement
  activeView?: string | null
  onOpenSurface(id: string): void
  onError(error: unknown): void
}): ReactElement | null {
  const { t } = useTranslation()
  const actions = sortContributions(host.actions.filter(action => action.placement === placement))
  if (!actions.length) return null
  const renderAction = (action: ActionContribution): ReactElement => {
    const target = resolveActionTarget(host, action)
    const available = target !== undefined
    const active = target?.type === "surface" && target.view.id === activeView
    const Icon = ICONS[action.icon ?? "blocks"]
    const run = (): void => {
      void Promise.resolve()
        .then(() => {
          if (target?.type === "command") return target.command.run()
          if (target?.type === "surface") return onOpenSurface(target.view.id)
          throw new Error(`Extension action target unavailable: ${action.target.id}`)
        })
        .catch(onError)
    }
    return placement === "topBar" ? (
      <Button
        key={action.id}
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        aria-label={action.title}
        title={available ? action.title : t("extensions.targetUnavailable", { name: action.title })}
        disabled={!available}
        onClick={run}>
        <Icon />
      </Button>
    ) : (
      <NavigationItemButton
        key={action.id}
        className={`${MENU_HIGHLIGHT} shrink-0 gap-2 px-2`}
        active={active}
        aria-current={active ? "page" : undefined}
        title={available ? action.title : t("extensions.targetUnavailable", { name: action.title })}
        disabled={!available}
        onClick={run}>
        <Icon />
        <span className="truncate">{action.title}</span>
      </NavigationItemButton>
    )
  }
  return placement === "topBar" ? (
    <div
      role="toolbar"
      aria-label={t("extensions.outlets.topBar")}
      dir="ltr"
      className="pointer-events-none grid w-full min-w-0 grid-cols-3 items-center gap-3">
      {ALIGNMENTS.map(alignment => (
        <BarGroup key={alignment} alignment={alignment}>
          {actions.filter(action => (action.alignment ?? "right") === alignment).map(renderAction)}
        </BarGroup>
      ))}
    </div>
  ) : (
    <nav aria-label={t("extensions.outlets.navigation")} className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
      {actions.map(renderAction)}
    </nav>
  )
}

export function ExtensionStatusBar({
  views,
  renderView
}: {
  views: ViewContribution[]
  renderView(view: ViewContribution): ReactNode
}): ReactElement | null {
  const { t } = useTranslation()
  const items = sortContributions(views.filter(view => view.kind === "statusBar"))
  if (!items.length) return null
  return (
    <section
      aria-label={t("extensions.outlets.statusBar")}
      dir="ltr"
      className="pointer-events-none grid h-8 w-full min-w-0 grid-cols-3 items-center gap-3 text-xs">
      {ALIGNMENTS.map(alignment => (
        <BarGroup key={alignment} alignment={alignment}>
          {items
            .filter(view => (view.alignment ?? "left") === alignment)
            .map(view => (
              <section key={view.id} aria-label={view.title} className="max-h-7 max-w-64 shrink-0 overflow-auto">
                {renderView(view)}
              </section>
            ))}
        </BarGroup>
      ))}
    </section>
  )
}

export function ExtensionSettingsNavigation({
  views,
  activeId,
  onSelect
}: {
  views: ViewContribution[]
  activeId: string | null
  onSelect(id: string): void
}): ReactElement | null {
  const { t } = useTranslation()
  const pages = sortContributions(views.filter(view => view.kind === "settingsPages"))
  if (!pages.length) return null
  return (
    <nav aria-label={t("extensions.outlets.settingsPages")} className="border-border mt-3 space-y-0.5 border-t pt-3">
      {pages.map(view => {
        const Icon = ICONS[view.icon ?? "settings"]
        return (
          <NavigationItemButton
            key={view.id}
            className={MENU_HIGHLIGHT}
            active={activeId === view.id}
            aria-current={activeId === view.id ? "page" : undefined}
            onClick={() => onSelect(view.id)}>
            <Icon />
            <span className="truncate" title={view.title}>
              {view.title}
            </span>
          </NavigationItemButton>
        )
      })}
    </nav>
  )
}

export function ExtensionSettingsContent({
  id,
  views,
  renderView
}: {
  id: string
  views: ViewContribution[]
  renderView(view: ViewContribution): ReactNode
}): ReactElement {
  const { t } = useTranslation()
  const view = views.find(item => item.id === id && item.kind === "settingsPages")
  return (
    <section className="space-y-4">
      <h1 className="text-lg font-semibold">{view?.title ?? t("extensions.unavailable")}</h1>
      {view && renderView(view)}
    </section>
  )
}
