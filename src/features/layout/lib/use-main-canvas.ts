import { useAtlas } from "@nyssance/atlas/react"
import { isTauri } from "@tauri-apps/api/core"
import {
  type ContextType,
  type RefCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { events } from "@/bindings"
import { useThreeFingerSwipeEnabled } from "@/lib/trackpad-preference"

import type { CanvasContext, CanvasWorkspace } from "./canvas-context"
import { resolveMainCanvasGeometry } from "./canvas-geometry"

export function useMainCanvas(
  screen: "main" | "leading",
  pinned: boolean,
  onScreenChange?: (screen: "main" | "leading") => void,
  trailing = false
): {
  ref: RefCallback<HTMLDivElement>
  navigationRef: RefCallback<HTMLDivElement>
  geometry: ReturnType<typeof resolveMainCanvasGeometry>
  context: NonNullable<ContextType<typeof CanvasContext>>
  selected: number
  moving: boolean
  navigationPeeking: boolean
  select: (index: number) => void
  width: number
  direction: "ltr" | "rtl"
} {
  const { i18n } = useTranslation()
  const direction = i18n.dir()
  // Direction changes are rebuilt with geometry, before restoring the semantic region.
  const [initialDirection] = useState(direction)
  const enabled = useThreeFingerSwipeEnabled()
  const viewport = useRef<HTMLDivElement>(null)
  const navigation = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ viewport: 0, navigation: 0 })
  const [workspace, setWorkspace] = useState<CanvasWorkspace>({
    chat: 0,
    preview: 0,
    visible: false,
    maximized: false
  })
  const [selected, setSelected] = useState(screen === "leading" ? 0 : 1)
  const [moving, setMoving] = useState(false)
  const settledSelection = useRef(selected)
  useLayoutEffect(() => {
    if (!moving) settledSelection.current = selected
  }, [moving, selected])
  const [navigationPeeking, setNavigationPeeking] = useState(false)
  const divider = useRef(false)
  const [dividerDragging, setDividerState] = useState(false)
  const appliedGeometry = useRef<string | null>(null)
  const [request, setRequest] = useState<{
    region: "chat" | "preview" | "trailing"
    revision: number
  } | null>(null)
  const appliedRequest = useRef<number | null>(null)
  const region = useRef<"leading" | "chat" | "preview" | "trailing">(screen === "leading" ? "leading" : "chat")
  const rebuilding = useRef(false)
  const previousScreen = useRef(screen)
  const [initialIndex] = useState(screen === "leading" ? 0 : 1)
  const callbacks = useRef({ onScreenChange, screen })
  useLayoutEffect(() => {
    callbacks.current = { onScreenChange, screen }
  }, [onScreenChange, screen])
  const geometry = useMemo(
    () => resolveMainCanvasGeometry({ ...size, pinned, chat: workspace.chat, preview: workspace.preview }, trailing),
    [size, pinned, workspace.chat, workspace.preview, trailing]
  )
  const geometryKey = `${geometry.stops.join(":")}:${geometry.content}:${direction}`
  const { ref: atlasRef, atlas: api } = useAtlas({
    regions: ".canvas-snap",
    pagination: {
      container: () =>
        viewport.current?.closest("[data-main-screen]")?.querySelector<HTMLElement>(".main-window-statusbar") ?? null,
      label: i18n.t("canvas.navigation"),
      pageLabel: (index) => i18n.t("canvas.page", { number: index + 1 }),
      overviewLabel: i18n.t("canvas.overview")
    },
    overview: {
      label: i18n.t("canvas.overview"),
      regions: "[data-atlas-overview-region], [data-atlas-navigation], .file-workspace-slide"
    },
    direction: initialDirection,
    contain: false,
    groupRegions: false,
    initialRegion: initialIndex === 0 ? "leading" : "chat",
    watchResize: false,
    watchRegions: false,
    manageInert: false,
    // Changing this option rebuilds Atlas. Defer docking until motion settles.
    navigationPinned: pinned && (moving ? settledSelection.current : selected) === 1,
    navigationWidth: size.navigation || 248,
    onNavigationChange: setNavigationPeeking,
    trackpadEnabled: enabled,
    trackpadAvailable: enabled && isTauri(),
    blocked: () => divider.current
  })
  const navigationRef = useCallback((node: HTMLDivElement | null): void => {
    navigation.current = node
  }, [])
  const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      viewport.current = node
      atlasRef(node)
    },
    [atlasRef]
  )

  useLayoutEffect(() => {
    const root = viewport.current
    const nav = navigation.current
    if (!root || !nav) return
    const measure = (): void => {
      const next = { viewport: root.clientWidth, navigation: nav.offsetWidth }
      setSize((current) =>
        current.viewport === next.viewport && current.navigation === next.navigation ? current : next
      )
    }
    measure()
    const observer = new ResizeObserver(() => flushSync(measure))
    observer.observe(root)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])

  const commitScreen = useCallback((index: number): void => {
    const next = index === 0 ? "leading" : "main"
    previousScreen.current = next
    if (next !== callbacks.current.screen) callbacks.current.onScreenChange?.(next)
  }, [])
  const navigate = useCallback((region: "chat" | "preview" | "trailing"): void => {
    setRequest((current) => ({ region, revision: (current?.revision ?? 0) + 1 }))
  }, [])
  const setDividerDragging = useCallback(
    (dragging: boolean): void => {
      divider.current = dragging
      setDividerState(dragging)
      if (dragging) api?.cancelInput()
    },
    [api]
  )

  useLayoutEffect(() => {
    if (!api || size.viewport === 0 || dividerDragging) return
    const requested = request !== null && appliedRequest.current !== request.revision
    const geometryChanged = appliedGeometry.current !== geometryKey
    if (!geometryChanged && !requested) return
    api?.cancelInput()
    rebuilding.current = true
    if (geometryChanged) {
      api.refresh({ direction })
      appliedGeometry.current = geometryKey
    }
    if (requested) region.current = request.region
    if (region.current === "preview" && !workspace.visible) region.current = "chat"
    const desired = region.current === "preview" && !geometry.split ? 1 : geometry.regions.indexOf(region.current)
    appliedRequest.current = request?.revision ?? null
    const animating = requested && !reduced() && api.getGeometry().selected !== desired
    api.goToSnap(desired, { instant: !animating })
    rebuilding.current = false
    if (requested) commitScreen(desired)
    setSelected(desired)
    setMoving(animating)
  }, [
    api,
    direction,
    geometryKey,
    geometry.stops.length,
    geometry.regions,
    geometry.split,
    workspace.visible,
    size.viewport,
    request,
    commitScreen,
    dividerDragging
  ])

  useEffect(() => {
    if (!api) return
    if (previousScreen.current !== screen) {
      region.current = screen === "leading" ? "leading" : "chat"
      api?.cancelInput()
      const target = screen === "leading" ? 0 : 1
      const animating =
        size.viewport > 0 &&
        !reduced() &&
        target < api.getGeometry().snaps.length &&
        api.getGeometry().selected !== target
      setMoving(animating)
      api.goToSnap(target, { instant: !animating })
    }
    previousScreen.current = screen
  }, [api, screen, size.viewport])

  useEffect(() => {
    if (!api) return
    const select = (): void => {
      const index = api.getGeometry().selected
      setSelected(index)
      if (!rebuilding.current) {
        const selectedRegion = geometry.regions[index]
        if (
          selectedRegion !== undefined &&
          !(selectedRegion === "chat" && region.current === "preview" && !geometry.split)
        )
          region.current = selectedRegion
      }
    }
    const stop = api.subscribe((state) => setMoving(state.moving))
    const settle = (): void => {
      setMoving(false)
      select()
      commitScreen(api.getGeometry().selected)
    }
    api.on("select", select).on("settle", settle)
    return () => {
      stop()
      api.off("select", select).off("settle", settle)
    }
  }, [api, commitScreen, geometry.regions, geometry.split])

  useEffect(() => {
    if (!api) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    if (enabled && isTauri()) {
      void events["trackpad-gesture"]
        .listen(({ payload }) => {
          if (!disposed) api.gesture(payload)
        })
        .then((stop) => {
          if (disposed) stop()
          else unsubscribe = stop
        })
        .catch((error: unknown) => {
          if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
        })
    }
    return () => {
      disposed = true
      unsubscribe?.()
      api.cancelInput()
    }
  }, [api, enabled])

  const select = (index: number): void => {
    if (api?.getGeometry().selected === index) return
    api?.cancelInput()
    const target = geometry.regions[index]
    if (target === undefined) throw new Error("Unknown canvas region")
    region.current = target
    const animating =
      size.viewport > 0 &&
      !!api &&
      !reduced() &&
      index < api.getGeometry().snaps.length &&
      api.getGeometry().selected !== index
    setMoving(animating)
    api?.goToSnap(index, { instant: !animating })
    commitScreen(index)
  }
  const context = useMemo(
    () => ({
      viewportWidth: size.viewport,
      budget: Math.max(0, size.viewport - (pinned ? size.navigation : 0)),
      selected,
      trailingActive: geometry.regions[selected] === "trailing",
      split: geometry.split,
      moving,
      setWorkspace,
      navigate,
      setDividerDragging
    }),
    [size, pinned, selected, geometry.split, geometry.regions, moving, navigate, setDividerDragging]
  )
  return {
    ref,
    navigationRef,
    geometry,
    context,
    selected,
    moving,
    navigationPeeking,
    select,
    width: size.viewport,
    direction
  }
}
