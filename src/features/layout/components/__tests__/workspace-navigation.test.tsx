import { type DesktopCanvas, DesktopWorkspace, useDesktopCanvas } from "@alwith/module-desktop-shell/react"
import type { AtlasController, AtlasOptions } from "@nyssance/atlas/dom"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

const observed = vi.hoisted(() => ({ api: null as AtlasController | null, options: {} as AtlasOptions }))
vi.mock("@nyssance/atlas/react", async (original) => {
  const actual = await original<typeof import("@nyssance/atlas/react")>()
  return {
    ...actual,
    useAtlas(options: AtlasOptions) {
      const result = actual.useAtlas(options)
      observed.api = result.atlas
      observed.options = options
      return result
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("showing a shared preview then resizing keeps chat; completed navigation is not replayed", async () => {
  let width = 1200
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.width) || (this.hasAttribute("data-atlas-region") ? 0 : width)
  })
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-atlas-region")) return 0
    let left = 0
    for (let node = this.previousElementSibling; node; node = node.previousElementSibling) {
      left += (node as HTMLElement).offsetWidth
    }
    return left
  })
  let canvas: DesktopCanvas | null = null
  function Chat() {
    canvas = useDesktopCanvas()
    return null
  }
  const workspace = (maximized = false) => (
    <DesktopWorkspace
      navigation={null}
      initialNavigationPinned
      panes={[
        { id: "chat", title: "Chat", children: <Chat />, min: 420, hidden: maximized },
        { id: "preview", title: "Preview", children: null, min: 320, resizable: true, maximized }
      ]}
    />
  )
  const view = render(workspace())
  await act(async () => {})
  const api = observed.api!
  act(() => {
    for (const node of api.getGeometry().regions) node.style.marginRight = "0px"
    api.refresh()
  })
  const navigate = (region: string) => act(() => canvas!.navigate(region))
  const resize = (next: number) =>
    act(() => {
      width = next
      const watch = observed.options.watchResize
      if (typeof watch !== "function") throw new Error("Missing resize handler")
      watch(api.root, [{ target: api.root.querySelector("[data-atlas-track]")! } as ResizeObserverEntry])
    })
  navigate("preview")
  expect(api.getState().activeRegion).toBe("chat")
  resize(700)
  expect(api.getState().activeRegion).toBe("chat")
  navigate("preview")
  expect(api.getState().activeRegion).toBe("preview")
  navigate("chat")
  resize(710)
  expect(api.getState().activeRegion).toBe("chat")
  expect(canvas!.region).toBe("chat")
  view.rerender(workspace(true))
  expect(api.getGeometry().regions.find((node) => node.dataset.atlasRegion === "chat")!.offsetWidth).toBe(0)
  navigate("chat")
  view.rerender(workspace())
  expect(api.getState().activeRegion).toBe("chat")
  resize(720)
  expect(api.getState().activeRegion).toBe("chat")
})
