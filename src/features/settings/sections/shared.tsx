// Settings primitives reduced from ALwith Desktop's settings sections: a group of rows,
// a muted group label, and a row with a title, optional description and a control.
import type { ReactNode } from "react"

export function SettingLabel({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground ms-1 mb-2 cursor-default text-sm">{children}</div>
}

export function SettingGroup({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col px-4">{children}</div>
}

export function SettingRow({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        {desc && <div className="text-muted-foreground mt-0.5 text-xs">{desc}</div>}
      </div>
      {children && <div className="shrink-0 pt-0.5">{children}</div>}
    </div>
  )
}
