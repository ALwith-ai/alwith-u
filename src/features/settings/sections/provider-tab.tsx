import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ProviderTab({
  id,
  name,
  active,
  configured,
  icon,
  onClick
}: {
  id: string
  name: string
  active: boolean
  configured: boolean
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={name}
      aria-pressed={active}
      onClick={onClick}
      className={cn("h-9 w-full gap-2 rounded-full px-4", active && "bg-accent")}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-center">{name}</span>
      <span
        data-testid={`${id}-status`}
        data-configured={configured}
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", configured ? "bg-success" : "bg-muted-foreground/30")}
      />
    </Button>
  )
}
