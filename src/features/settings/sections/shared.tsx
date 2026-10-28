// Settings primitives reduced from ALwith Desktop's settings sections: a group of rows,
// a muted group label, and a row with a title, optional description and a control.
import { type ReactNode, useId } from "react"

import { cn } from "@/lib/utils"

export function SettingLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 cursor-default text-sm font-medium">{children}</h2>
}

export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group flex w-full min-w-0 flex-col">{children}</div>
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
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      aria-describedby={desc ? `${id}-description` : undefined}
      className={cn("settings-row", aligned && "settings-row-aligned")}
    >
      <div className="settings-row-label min-w-0">
        <div id={`${id}-title`} className="text-sm leading-5 font-medium">
          {title}
        </div>
        {desc && (
          <div
            id={`${id}-description`}
            className="settings-row-description mt-1 text-xs leading-5 text-muted-foreground"
          >
            {desc}
          </div>
        )}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  )
}
