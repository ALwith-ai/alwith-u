// Settings primitives reduced from ALwith Desktop's settings sections: a group of rows,
// a muted group label, and a row with a title, optional description and a control.
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SettingLabel({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground ms-1 mb-2 cursor-default text-sm">{children}</div>
}

export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col px-4">{children}</div>
}

export function SettingRow({
  title,
  desc,
  children,
  aligned = false
}: {
  title: string
  desc?: string
  children?: ReactNode
  aligned?: boolean
}) {
  return (
    <div
      className={cn(
        "items-start gap-4 py-3",
        aligned ? "grid grid-cols-[minmax(0,1fr)_16rem]" : "flex justify-between"
      )}>
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        {desc && <div className="text-muted-foreground mt-0.5 text-xs">{desc}</div>}
      </div>
      {children && <div className={cn("pt-0.5", aligned ? "min-w-0" : "shrink-0")}>{children}</div>}
    </div>
  )
}
