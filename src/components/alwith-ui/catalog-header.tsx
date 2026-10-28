import type { ReactNode } from "react"

/** Shared title geometry for the catalog and archive pages. */
export function CatalogHeader({ title, badge, children }: { title: string; badge?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-h-9 items-center gap-2">
        <h1 className="text-2xl leading-9 font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      {children}
    </header>
  )
}
