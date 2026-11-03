import { LeadingNavigation as DesktopLeadingNavigation } from "@alwith/module-desktop-shell/react"
import { ArchiveIcon, LayoutGridIcon, PawPrintIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

/** U's pages on the shell's leading rail; extensions live under the plugins entry. */
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
}): ReactNode {
  const { t } = useTranslation()
  return (
    <DesktopLeadingNavigation
      label={t("sidebar.leadingNavigation")}
      activePage={activePage === "extensions" ? "plugins" : activePage}
      items={[
        { id: "plugins", label: t("plugins.catalog.customize"), icon: LayoutGridIcon, onClick: onOpenPlugins },
        { id: "vibemon", label: t("sidebar.vibemon"), icon: PawPrintIcon, onClick: onOpenVibemon },
        { id: "archives", label: t("archives.title"), icon: ArchiveIcon, onClick: onOpenArchives }
      ]}
    >
      {children}
    </DesktopLeadingNavigation>
  )
}
