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
import { useBrowserQuickChat } from "@/features/browser/quick-chat-state"
import { ChatOpenLocalLinkContext, ChatOpenWebLinkContext } from "@/features/chat/file-actions"
import { WorkspaceBrowserEntryContext } from "@/features/workspace/context"
import { useRuntimeCapabilities } from "@/lib/runtime-capabilities"
import "@nyssance/atlas/styles.css"
import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  type OpenWorkspaceChatFile,
  type PreviewPane,
  PreviewPaneContext
} from "@/features/workspace/preview-pane-context"
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
  const [browser, setBrowser] = useState({ visited: false, hidden: true, maximized: false, revealRequest: 0 })
  const showBrowser = useCallback(() => {
    setBrowser((state) => ({ ...state, visited: true, hidden: false, revealRequest: state.revealRequest + 1 }))
  }, [])
  const [chatLinks, setChatLinks] = useState<readonly { id: string; url: string }[]>([])
  const openChatLink = useCallback(
    async (url: string) => {
      if (!capabilities?.embeddedBrowser) throw new Error(t("browser.embeddedUnavailable"))
      const destination = new URL(url).href
      setChatLinks((links) => [...links, { id: crypto.randomUUID(), url: destination }])
      showBrowser()
    },
    [capabilities?.embeddedBrowser, showBrowser, t]
  )
  const consumeChatLinks = useCallback((ids: readonly string[]) => {
    setChatLinks((links) => links.filter((link) => !ids.includes(link.id)))
  }, [])
  const browserChatRequested = useBrowserQuickChat((state) => state.revealSessionId)
  useEffect(() => {
    if (browserChatRequested && capabilities?.embeddedBrowser) showBrowser()
  }, [browserChatRequested, capabilities?.embeddedBrowser, showBrowser])
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
  const workspaceChatFile = useRef<OpenWorkspaceChatFile | null>(null)
  const registerOpenChatFile = useCallback((handler: OpenWorkspaceChatFile) => {
    workspaceChatFile.current = handler
    return () => {
      if (workspaceChatFile.current === handler) workspaceChatFile.current = null
    }
  }, [])
  const openBrowserChatFile = useCallback<OpenWorkspaceChatFile>(async (path, position) => {
    const open = workspaceChatFile.current
    if (!open) throw new Error("The main workspace is unavailable")
    await open(path, position)
  }, [])
  const previewPane = useMemo(
    () => ({ slot: previewSlot, show, registerDetach, registerOpenChatFile }),
    [previewSlot, show, registerDetach, registerOpenChatFile]
  )
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
            <DropdownMenuItem className="whitespace-nowrap" aria-label={t("browser.open")} onClick={showBrowser}>
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              {t("browser.title")}
            </DropdownMenuItem>
          ) : null
        }
      >
        <DesktopWorkspace
          navigation={<NavigationOverlayBridge>{sidebar}</NavigationOverlayBridge>}
          leading={leading}
          panes={[
            {
              id: "chat",
              title: t("chat.timeline"),
              children: <ChatOpenWebLinkContext.Provider value={openChatLink}>{main}</ChatOpenWebLinkContext.Provider>,
              min: 420,
              movable: true
            },
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
                      <ChatOpenWebLinkContext.Provider value={openChatLink}>
                        <ChatOpenLocalLinkContext.Provider value={openBrowserChatFile}>
                          <BrowserWorkspace
                            request={previewRequest}
                            chatLinks={chatLinks}
                            onConsumeChatLinks={consumeChatLinks}
                            sessionTitles={browserSessionTitles}
                            revealRequest={browser.revealRequest}
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
                        </ChatOpenLocalLinkContext.Provider>
                      </ChatOpenWebLinkContext.Provider>
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
