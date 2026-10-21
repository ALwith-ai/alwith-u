import { isTauri } from "@tauri-apps/api/core"
import useEmblaCarousel from "embla-carousel-react"
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

import { CanvasContext, type CanvasWorkspace } from "./canvas-context"
import { resolveCanvasGeometry } from "./canvas-geometry"
import { attachCanvasInput } from "./canvas-input"

export function useMainCanvas(
  screen: "main" | "leading",
  pinned: boolean,
  onScreenChange?: (screen: "main" | "leading") => void
): {
  ref: RefCallback<HTMLDivElement>
  navigationRef: RefCallback<HTMLDivElement>
  geometry: ReturnType<typeof resolveCanvasGeometry>
  context: NonNullable<ContextType<typeof CanvasContext>>
  selected: number
  moving: boolean
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
  const [workspace, setWorkspace] = useState<CanvasWorkspace>({ chat: 0, preview: 0, visible: false, maximized: false })
  const [selected, setSelected] = useState(screen === "leading" ? 0 : 1)
  const [moving, setMoving] = useState(false)
  const divider = useRef(false)
  const [dividerDragging, setDividerState] = useState(false)
  const appliedGeometry = useRef<string | null>(null)
  const [request, setRequest] = useState<{ region: "chat" | "preview"; revision: number } | null>(null)
  const appliedRequest = useRef<number | null>(null)
  const region = useRef<"leading" | "chat" | "preview">(screen === "leading" ? "leading" : "chat")
  const rebuilding = useRef(false)
  const previousScreen = useRef(screen)
  const [initialIndex] = useState(screen === "leading" ? 0 : 1)
  const callbacks = useRef({ onScreenChange, screen })
  useLayoutEffect(() => {
    callbacks.current = { onScreenChange, screen }
  }, [onScreenChange, screen])
  const geometry = resolveCanvasGeometry({ ...size, pinned, chat: workspace.chat, preview: workspace.preview })
  const geometryKey = geometry.stops.join(":") + `:${geometry.content}:${direction}`
  const [emblaRef, api] = useEmblaCarousel({
    container: ".main-screen-track",
    slides: ".canvas-snap",
    axis: "x",
    direction: initialDirection,
    align: "start",
    containScroll: false,
    slidesToScroll: 1,
    startIndex: initialIndex,
    watchResize: false,
    watchSlides: false,
    watchDrag: (_api, event) => !event.isTrusted
  })
  const input = useRef<ReturnType<typeof attachCanvasInput> | null>(null)
  const navigationRef = useCallback((node: HTMLDivElement | null): void => {
    navigation.current = node
  }, [])
  const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      viewport.current = node
      emblaRef(node)
    },
    [emblaRef]
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
  const navigate = useCallback((region: "chat" | "preview"): void => {
    setRequest((current) => ({ region, revision: (current?.revision ?? 0) + 1 }))
  }, [])
  const setDividerDragging = useCallback((dragging: boolean): void => {
    divider.current = dragging
    setDividerState(dragging)
    if (dragging) input.current?.cancel()
  }, [])

  useLayoutEffect(() => {
    if (!api || size.viewport === 0 || dividerDragging) return
    const requested = request !== null && appliedRequest.current !== request.revision
    const geometryChanged = appliedGeometry.current !== geometryKey
    if (!geometryChanged && !requested) return
    input.current?.cancel()
    rebuilding.current = true
    if (geometryChanged) {
      api.reInit({ direction })
      appliedGeometry.current = geometryKey
    }
    if (requested) region.current = request.region
    if (region.current === "preview" && !workspace.visible) region.current = "chat"
    const desired =
      region.current === "leading" ? 0 : region.current === "preview" ? Math.min(2, geometry.stops.length - 1) : 1
    appliedRequest.current = request?.revision ?? null
    const animating = requested && !reduced() && api.selectedScrollSnap() !== desired
    api.scrollTo(desired, !animating)
    rebuilding.current = false
    if (requested) commitScreen(desired)
    setSelected(desired)
    setMoving(animating)
  }, [
    api,
    direction,
    geometryKey,
    geometry.stops.length,
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
      input.current?.cancel()
      const target = screen === "leading" ? 0 : 1
      const animating =
        size.viewport > 0 && !reduced() && target < api.scrollSnapList().length && api.selectedScrollSnap() !== target
      setMoving(animating)
      api.scrollTo(target, !animating)
    }
    previousScreen.current = screen
  }, [api, screen, size.viewport])

  useEffect(() => {
    if (!api) return
    const select = (): void => {
      const index = api.selectedScrollSnap()
      setSelected(index)
      if (!rebuilding.current) {
        if (index === 0) region.current = "leading"
        else if (index === 2) region.current = "preview"
        else if (api.scrollSnapList().length > 2 || region.current !== "preview") region.current = "chat"
      }
    }
    const move = (): void => setMoving(true)
    const settle = (): void => {
      setMoving(false)
      select()
      commitScreen(api.selectedScrollSnap())
    }
    api.on("select", select).on("scroll", move).on("settle", settle)
    return () => {
      api.off("select", select).off("scroll", move).off("settle", settle)
    }
  }, [api, commitScreen])

  useEffect(() => {
    if (!api) return
    const blocked = (): boolean =>
      divider.current ||
      !!viewport.current?.closest("[inert]") ||
      !!document.querySelector(
        '[role="dialog"][data-open], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]'
      )
    const controller = attachCanvasInput(api, blocked)
    input.current = controller
    let disposed = false
    let unsubscribe: (() => void) | undefined
    if (enabled && isTauri()) {
      void events["trackpad-gesture"]
        .listen(({ payload }) => {
          if (!disposed) controller.gesture(payload)
        })
        .then((stop) => {
          if (disposed) stop()
          else unsubscribe = stop
        })
        .catch((error: unknown) => {
          if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
        })
    }
    const observer = new MutationObserver(() => {
      if (blocked()) controller.cancel()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["inert", "data-state", "data-open", "open"]
    })
    return () => {
      disposed = true
      unsubscribe?.()
      observer.disconnect()
      controller.dispose()
      input.current = null
    }
  }, [api, enabled])

  const select = (index: number): void => {
    input.current?.cancel()
    region.current = index === 0 ? "leading" : index === 2 ? "preview" : "chat"
    const animating =
      size.viewport > 0 &&
      !!api &&
      !reduced() &&
      index < api.scrollSnapList().length &&
      api.selectedScrollSnap() !== index
    setMoving(animating)
    api?.scrollTo(index, !animating)
    commitScreen(index)
  }
  const context = useMemo(
    () => ({
      viewportWidth: size.viewport,
      budget: Math.max(0, size.viewport - (pinned ? size.navigation : 0)),
      selected,
      split: geometry.stops.length > 2,
      moving,
      setWorkspace,
      navigate,
      setDividerDragging
    }),
    [size, pinned, selected, geometry.stops.length, moving, navigate, setDividerDragging]
  )
  return { ref, navigationRef, geometry, context, selected, moving, select, width: size.viewport, direction }
}
