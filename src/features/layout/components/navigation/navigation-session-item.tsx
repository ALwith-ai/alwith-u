import { LockIcon } from "lucide-react"
import { type ComponentProps, createContext, type ReactNode, useContext, useState } from "react"
import { CodexHoverCard } from "@/components/alwith-ui/codex-hover-card"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { SessionStateDot } from "@/components/alwith-ui/session-state-dot"
import { ROW_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { TRAILING_GROUP, TrailingSlot, TrailingSwap } from "@/components/alwith-ui/trailing-swap"
import { NavigationLeading } from "@/features/layout/components/navigation/navigation-leading"
import { openExternal as openUrl } from "@/lib/open"
import type { RunState } from "@/lib/run-state"
import { cn } from "@/lib/utils"

const NavigationHoverCardPinContext = createContext<(pinned: boolean) => void>(() => {})
const NavigationHoverCardCloseContext = createContext<() => void>(() => {})

export function useNavigationHoverCardClose(): () => void {
  return useContext(NavigationHoverCardCloseContext)
}

export function useNavigationHoverCardPin(): (pinned: boolean) => void {
  return useContext(NavigationHoverCardPinContext)
}

type NavigationSessionItemProps = Omit<ComponentProps<"div">, "title"> & {
  active?: boolean
  state?: RunState
  leased?: boolean
  media?: ReactNode
  title: ReactNode
  hoverCard?: ReactNode
  subtitle?: ReactNode
  listeningPorts?: number[]
  accessory?: ReactNode
  meta?: ReactNode
  hint?: ReactNode
  actions?: ReactNode
}

export function NavigationSessionItem({
  active = false,
  state,
  leased = false,
  media,
  title,
  hoverCard,
  subtitle,
  listeningPorts,
  accessory,
  meta,
  hint,
  actions,
  className,
  ...props
}: NavigationSessionItemProps) {
  const row = (
    <div
      data-slot="navigation-session-item"
      data-active={active}
      className={cn(
        TRAILING_GROUP,
        ROW_HIGHLIGHT,
        "group/navigation-row focus-visible:outline-ring flex h-[var(--navigation-row-height)] w-full items-center gap-1 overflow-hidden rounded-[10px] ps-1 pe-1.5 text-start text-sm outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
        className
      )}
      {...props}>
      <NavigationLeading>{state != null ? <SessionStateDot state={state} /> : media}</NavigationLeading>
      <span className="flex min-w-0 flex-1 flex-col">
        <OverflowMarquee className={cn("leading-none", state === "done" && "font-semibold")}>{title}</OverflowMarquee>
        {subtitle != null && <OverflowMarquee className="text-muted-foreground text-xs">{subtitle}</OverflowMarquee>}
        {listeningPorts != null && listeningPorts.length > 0 && (
          <span className="text-muted-foreground flex gap-2 font-mono text-xs">
            {listeningPorts.map(port => {
              const url = `http://localhost:${port}`
              return (
                <button
                  key={port}
                  type="button"
                  className="underline"
                  onPointerDown={event => event.stopPropagation()}
                  onKeyDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation()
                    void openUrl(url)
                  }}>
                  :{port}
                </button>
              )
            })}
          </span>
        )}
      </span>
      <span className="relative ms-auto flex shrink-0 items-center gap-1">
        {leased && <LockIcon className="text-muted-foreground size-3" />}
        <TrailingSwap
          content={accessory != null ? <TrailingSlot>{accessory}</TrailingSlot> : (meta ?? <TrailingSlot />)}
          actions={actions}
        />
        {hint != null && (
          <span className="pointer-events-none absolute end-1 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center">
            {hint}
          </span>
        )}
      </span>
    </div>
  )

  if (hoverCard == null) return row
  return <NavigationSessionHoverCard row={row}>{hoverCard}</NavigationSessionHoverCard>
}

function NavigationSessionHoverCard({ row, children }: { row: React.ReactElement; children: ReactNode }) {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  return (
    <NavigationHoverCardPinContext.Provider value={setPinned}>
      <NavigationHoverCardCloseContext.Provider
        value={() => {
          setHovering(false)
          setPinned(false)
        }}>
        <CodexHoverCard open={hovering || pinned} onOpenChange={setHovering} trigger={row}>
          {children}
        </CodexHoverCard>
      </NavigationHoverCardCloseContext.Provider>
    </NavigationHoverCardPinContext.Provider>
  )
}
