import { SidebarOverlayContext } from "@alwith/module-chat/session-list"
import {
  type DesktopCanvasRegion,
  DesktopNavigationOverlayContext,
  type DesktopScreen,
  DesktopWorkspace,
  useDesktopZoom
} from "@alwith/module-desktop-shell/react"
import { MIN_PREVIEW_WIDTH } from "@nyssance/atlas/layout"
import { Globe } from "lucide-react"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { BrowserWorkspace } from "@/features/browser/browser-workspace"
import { usePreviewRequest } from "@/features/browser/preview-request"
import { WorkspaceBrowserEntryContext } from "@/features/workspace/context"
import { useRuntimeCapabilities } from "@/lib/runtime-capabilities"
import "@nyssance/atlas/styles.css"
import { type ReactNode, useCallback, useContext, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { type PreviewPane, PreviewPaneContext } from "@/features/workspace/preview-pane-context"
import { openExternal } from "@/lib/open"
import { savePreference } from "@/lib/preferences"
import { useThreeFingerSwipeEnabled } from "@/lib/trackpad-preference"

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
  browserSessionTitles,
  initialPinned,
  initialPaneOrder,
  screen,
  onScreenChange,
  onRegionChange,
  sidebar,
  leading,
  main,
  trailing,
  toolbar,
  statusBar,
  children
}: {
  browserSessionTitles?: Readonly<Record<string, string | null | undefined>>
  initialPinned: boolean
  /** The user's order of chat, preview and browser; each can be moved by its grip. */
  initialPaneOrder?: readonly string[]
  screen: MainScreen
  onScreenChange?: (screen: MainScreen) => void
  /** The canvas's foreground region; chat collapsed beside a maximized preview is not it. */
  onRegionChange?: (region: DesktopCanvasRegion) => void
  sidebar: ReactNode
  leading: ReactNode
  main: ReactNode
  trailing?: ReactNode
  toolbar?: ReactNode
  statusBar?: ReactNode
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const { level: zoom } = useDesktopZoom()
  const capabilities = useRuntimeCapabilities()
  const trackpad = useThreeFingerSwipeEnabled()
  const [browser, setBrowser] = useState({ visited: false, hidden: true, maximized: false })
  const showBrowser = useCallback(() => {
    setBrowser((state) => ({ ...state, visited: true, hidden: false }))
    setPreview((state) => ({ ...state, maximized: false }))
  }, [])
  const previewRequest = usePreviewRequest(!!capabilities?.embeddedBrowser, showBrowser)
  // Chat, then the preview the file workspace fills from inside chat; hidden until it opens.
  const [previewSlot, setPreviewSlot] = useState<HTMLElement | null>(null)
  const [preview, setPreview] = useState({ hidden: true, maximized: false })
  const show = useCallback<PreviewPane["show"]>(
    (next) =>
      setPreview((current) =>
        current.hidden === next.hidden && current.maximized === next.maximized ? current : next
      ),
    []
  )
  const [detach, setDetach] = useState<(() => void) | undefined>()
  const registerDetach = useCallback((handler: () => void) => {
    setDetach(() => handler)
    return () => setDetach((current) => (current === handler ? undefined : current))
  }, [])
  const previewPane = useMemo(() => ({ slot: previewSlot, show, registerDetach }), [previewSlot, show, registerDetach])
  const labels = useMemo(
    () => ({
      pin: t("sidebar.pin"),
      unpin: t("sidebar.unpin"),
      pages: t("canvas.navigation"),
      page: (number: number) => t("canvas.page", { number }),
      overview: t("canvas.overview"),
      movePane: (title: string) => t("canvas.movePane", { title })
    }),
    [t]
  )
  const persistPinned = useCallback((pinned: boolean) => savePreference("sidebarPinned", pinned), [])
  const persistPaneOrder = useCallback((order: string[]) => savePreference("paneOrder", order), [])
  const openLink = useCallback((url: string) => void openExternal(url).catch(report), [])
  const regionChanged = useCallback(
    (region: DesktopCanvasRegion) => {
      // Overview exits settle instantly and do not emit the animated screen-change event.
      const next = region === "leading" ? "leading" : "main"
      if (next !== screen) onScreenChange?.(next)
      onRegionChange?.(region)
    },
    [screen, onScreenChange, onRegionChange]
  )
  return (
    <PreviewPaneContext.Provider value={previewPane}>
      <WorkspaceBrowserEntryContext.Provider
        value={
          capabilities?.embeddedBrowser ? (
            <DropdownMenuItem
              aria-label={t("browser.open")}
              onClick={() =>
                setBrowser((state) => ({
                  ...state,
                  visited: true,
                  hidden: !state.hidden
                }))
              }
            >
              <Globe />
              {t("browser.title")}
            </DropdownMenuItem>
          ) : null
        }
      >
        <DesktopWorkspace
          navigation={<NavigationOverlayBridge>{sidebar}</NavigationOverlayBridge>}
          leading={leading}
          panes={[
            { id: "chat", title: t("chat.timeline"), children: main, min: 420, movable: true },
            {
              id: "preview",
              onDetach: detach,
              title: t("workspace.preview"),
              children: <div ref={setPreviewSlot} className="flex min-h-0 flex-1 flex-col" />,
              min: MIN_PREVIEW_WIDTH,
              hidden: preview.hidden,
              maximized: preview.maximized,
              resizable: true,
              movable: true
            },
            ...(capabilities?.embeddedBrowser
              ? [
                  {
                    id: "browser",
                    title: t("browser.title"),
                    min: 420,
                    hidden: browser.hidden,
                    maximized: browser.maximized,
                    resizable: true,
                    movable: true,
                    children: browser.visited ? (
                      <BrowserWorkspace
                        request={previewRequest}
                        sessionTitles={browserSessionTitles}
                        active={!browser.hidden}
                        maximized={browser.maximized}
                        onMaximize={() =>
                          setBrowser((state) => ({
                            ...state,
                            maximized: !state.maximized
                          }))
                        }
                        onClose={() => setBrowser((state) => ({ ...state, hidden: true }))}
                      />
                    ) : null
                  }
                ]
              : [])
          ]}
          trailing={trailing}
          toolbar={<div className="main-workspace-toolbar flex flex-nowrap items-center gap-2">{toolbar}</div>}
          statusBar={statusBar}
          overlays={children}
          screen={screen}
          onScreenChange={onScreenChange}
          onRegionChange={regionChanged}
          initialNavigationPinned={initialPinned}
          onNavigationPinnedChange={persistPinned}
          initialPaneOrder={initialPaneOrder}
          onPaneOrderChange={persistPaneOrder}
          labels={labels}
          direction={i18n.dir()}
          trackpad={trackpad}
          zoom={zoom}
          openLink={openLink}
          onError={report}
        />
      </WorkspaceBrowserEntryContext.Provider>
    </PreviewPaneContext.Provider>
  )
}
