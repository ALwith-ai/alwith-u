import type { ReactNode } from "react"

// Match the extension and archive pages: 32px above the shared 36px title row.
export const pluginContentClassName = "w-full px-10 pb-6"

export function PluginPageHeader({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 px-10 pt-8">
      <div className="flex h-9 items-center [&>header]:w-full [&>nav]:w-full" data-plugin-page-header="">
        {children}
      </div>
    </div>
  )
}
