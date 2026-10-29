import type { ReactNode } from "react"

import "./toolbox.css"

/** Shared catalog and detail geometry for plugins, skills and app extensions. */
export const toolboxContentClassName = "toolbox-content pb-8"
export const toolboxDialogClassName =
  "toolbox-detail flex max-h-[85dvh] flex-col gap-6 overflow-hidden rounded-2xl p-6 sm:max-w-3xl"

export function ToolboxPageHeader({ children }: { children: ReactNode }) {
  return (
    <div className="toolbox-content shrink-0 pt-8">
      <div
        className="toolbox-toolbar flex min-h-9 items-center [&>header]:w-full [&>nav]:w-full"
        data-plugin-page-header=""
      >
        {children}
      </div>
    </div>
  )
}
