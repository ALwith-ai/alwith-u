import { SidebarOverlayContext } from "@alwith/module-chat/session-list"
import {
  DesktopNavigationOverlayContext,
  type DesktopScreen,
  DesktopWorkspace
} from "@alwith/module-desktop-shell/react"
import "@nyssance/atlas/styles.css"
import { type ReactNode, useCallback, useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useStore } from "zustand"

import { openExternal } from "@/lib/open"
import { savePreference } from "@/lib/preferences"
import { useThreeFingerSwipeEnabled } from "@/lib/trackpad-preference"
import { zoomStore } from "@/lib/zoom"

export type MainScreen = DesktopScreen

/** Hands the shell's navigation-overlay retention to module-chat's session list menus. */
function NavigationOverlayBridge({ children }: { children: ReactNode }) {
  const retain = useContext(DesktopNavigationOverlayContext)
  return <SidebarOverlayContext.Provider value={retain}>{children}</SidebarOverlayContext.Provider>
}

const report = (error: unknown): void => {
  toast.error(error instanceof Error ? error.message : String(error))
}

/** U's main window is the shell's DesktopWorkspace; U supplies its strings, preferences and pages. */
export function MainSidebarLayout({
  initialPinned,
  screen,
  onScreenChange,
  sidebar,
  leading,
  main,
  trailing,
  toolbar,
  statusBar,
  children
}: {
  initialPinned: boolean
  screen: MainScreen
  onScreenChange?: (screen: MainScreen) => void
  sidebar: ReactNode
  leading: ReactNode
  main: ReactNode
  trailing?: ReactNode
  toolbar?: ReactNode
  statusBar?: ReactNode
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const zoom = useStore(zoomStore, (state) => state.level)
  const trackpad = useThreeFingerSwipeEnabled()
  const labels = useMemo(
    () => ({
      pin: t("sidebar.pin"),
      unpin: t("sidebar.unpin"),
      pages: t("canvas.navigation"),
      page: (number: number) => t("canvas.page", { number }),
      overview: t("canvas.overview")
    }),
    [t]
  )
  const persistPinned = useCallback((pinned: boolean) => savePreference("sidebarPinned", pinned), [])
  const openLink = useCallback((url: string) => void openExternal(url).catch(report), [])
  const regionChanged = useCallback(
    (region: "leading" | "chat" | "preview" | "trailing") => {
      // Overview exits settle instantly and do not emit the animated screen-change event.
      const next = region === "leading" ? "leading" : "main"
      if (next !== screen) onScreenChange?.(next)
    },
    [screen, onScreenChange]
  )
  return (
    <DesktopWorkspace
      navigation={<NavigationOverlayBridge>{sidebar}</NavigationOverlayBridge>}
      leading={leading}
      trailing={trailing}
      toolbar={toolbar}
      statusBar={statusBar}
      overlays={children}
      screen={screen}
      onScreenChange={onScreenChange}
      onRegionChange={regionChanged}
      initialNavigationPinned={initialPinned}
      onNavigationPinnedChange={persistPinned}
      labels={labels}
      direction={i18n.dir()}
      trackpad={trackpad}
      zoom={zoom}
      openLink={openLink}
      onError={report}
    >
      {main}
    </DesktopWorkspace>
  )
}
