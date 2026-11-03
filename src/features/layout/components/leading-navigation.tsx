import { LeadingNavigation as DesktopLeadingNavigation } from "@alwith/module-desktop-shell/react"
import { ArchiveIcon, LayoutGridIcon, PawPrintIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { ImageIcon } from "@/features/images/image-icon"

/** U's pages on the shell's leading rail; extensions live under the plugins entry. */
export function LeadingNavigation({
  activePage,
  onOpenVibemon,
  onOpenPlugins,
  onOpenArchives,
  onOpenImages,
  children
}: {
  activePage: "vibemon" | "plugins" | "extensions" | "archives" | "images" | null
  children?: ReactNode
  onOpenVibemon: () => void
  onOpenPlugins: () => void
  onOpenImages?: () => void
  onOpenArchives: () => void
}): ReactNode {
  const { t } = useTranslation()
  return (
    <DesktopLeadingNavigation
      label={t("sidebar.leadingNavigation")}
      activePage={activePage === "extensions" ? "plugins" : activePage}
      items={[
        { id: "plugins", label: t("plugins.catalog.customize"), icon: LayoutGridIcon, onClick: onOpenPlugins },
        ...(onOpenImages ? [{ id: "images", label: t("images.title"), icon: ImageIcon, onClick: onOpenImages }] : []),
        { id: "vibemon", label: t("sidebar.pets"), icon: PawPrintIcon, onClick: onOpenVibemon },
        { id: "archives", label: t("archives.title"), icon: ArchiveIcon, onClick: onOpenArchives }
      ]}
    >
      {children}
    </DesktopLeadingNavigation>
  )
}
