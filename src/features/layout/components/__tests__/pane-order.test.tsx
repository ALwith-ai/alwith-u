import { arrangePanes, DesktopWorkspace, movePaneOrder } from "@alwith/module-desktop-shell/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const panes = (overrides: { browserHidden?: boolean } = {}) => [
  { id: "chat", title: "Chat", children: <p>chat body</p>, min: 420, movable: true },
  { id: "preview", title: "Preview", children: <p>preview body</p>, min: 320, resizable: true, movable: true },
  { id: "browser", title: "Browser", children: null, min: 420, movable: true, hidden: overrides.browserHidden ?? true }
]

const drawnOrder = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>("[data-screen-panel]")]
    .map((node) => node.dataset.screenPanel!)
    .filter((id) => !["leading", "trailing"].includes(id))

test("the user's order places movable panes and leaves fixed panes where the host put them", () => {
  const host = [{ id: "a", movable: true }, { id: "fixed" }, { id: "b", movable: true }, { id: "c", movable: true }]
  expect(arrangePanes(host, ["c", "a"]).map((pane) => pane.id)).toEqual(["c", "fixed", "a", "b"])
  // Unknown and missing IDs fall back to the host's order.
  expect(arrangePanes(host, ["gone"]).map((pane) => pane.id)).toEqual(["a", "fixed", "b", "c"])
  expect(movePaneOrder(host, "a", "c")).toEqual(["b", "c", "a"])
  expect(movePaneOrder(host, "c", "a")).toEqual(["c", "a", "b"])
  expect(movePaneOrder(host, "fixed", "a")).toEqual(["a", "b", "c"])
})

test("arrow keys on a grip swap the pane with its visible neighbour, keep focus and persist the order", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200)
  const saved: string[][] = []
  const view = render(
    <DesktopWorkspace
      navigation={null}
      initialNavigationPinned
      panes={panes()}
      onPaneOrderChange={(order) => void saved.push(order)}
    />
  )
  await act(async () => {})
  expect(drawnOrder(view.container)).toEqual(["chat", "preview", "browser"])
  // The hidden browser has no grip; chat and preview each have one.
  expect(view.queryByRole("button", { name: "Move Browser" })).toBeNull()
  const chatGrip = view.getByRole("button", { name: "Move Chat" })
  expect(view.container.querySelector('[data-screen-panel="preview"] > .desktop-shell-divider')).toHaveProperty(
    "dataset.edge",
    "start"
  )
  chatGrip.focus()
  fireEvent.keyDown(chatGrip, { key: "ArrowRight" })
  await act(async () => {})
  // The hidden browser is skipped: chat moves past preview only.
  expect(drawnOrder(view.container)).toEqual(["preview", "chat", "browser"])
  expect(saved).toEqual([["preview", "chat", "browser"]])
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Move Chat" }))
  // Leading its screen, preview's divider rides the edge it shares with chat.
  expect(view.container.querySelector('[data-screen-panel="preview"] > .desktop-shell-divider')).toHaveProperty(
    "dataset.edge",
    "end"
  )
  // Nothing lies past the end.
  fireEvent.keyDown(view.getByRole("button", { name: "Move Chat" }), { key: "ArrowRight" })
  await act(async () => {})
  expect(saved).toHaveLength(1)
  // Content stays mounted across the move.
  expect(view.getByText("chat body")).toBeTruthy()
})

test("dragging a grip onto another pane moves it there; a short press moves nothing", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600)
  const view = render(
    <DesktopWorkspace
      navigation={null}
      initialNavigationPinned
      initialPaneOrder={["browser", "chat", "preview"]}
      panes={panes({ browserHidden: false })}
    />
  )
  await act(async () => {})
  expect(drawnOrder(view.container)).toEqual(["browser", "chat", "preview"])
  const bounds: Record<string, [number, number]> = { browser: [0, 500], chat: [500, 1000], preview: [1000, 1500] }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [left, right] = bounds[this.dataset.screenPanel ?? ""] ?? [0, 0]
    return { left, right, width: right - left, top: 0, bottom: 800, height: 800, x: left, y: 0, toJSON: () => ({}) }
  })
  const grip = view.getByRole("button", { name: "Move Preview" })
  Object.defineProperty(grip, "setPointerCapture", { value: vi.fn() })
  fireEvent.pointerDown(grip, { button: 0, clientX: 1250, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientX: 1247, pointerId: 1 })
  fireEvent.pointerUp(grip, { pointerId: 1 })
  expect(drawnOrder(view.container)).toEqual(["browser", "chat", "preview"])

  fireEvent.pointerDown(grip, { button: 0, clientX: 1250, pointerId: 2 })
  fireEvent.pointerMove(grip, { clientX: 200, pointerId: 2 })
  const browser = view.container.querySelector<HTMLElement>('[data-screen-panel="browser"]')!
  expect(browser.dataset.paneDropTarget).toBe("true")
  // Embedded pages under the pointer are shielded for the whole drag.
  expect(document.querySelector<HTMLElement>(".desktop-shell-drag-shield")?.dataset.drag).toBe("pane")
  expect(view.container.querySelector<HTMLElement>('[data-screen-panel="preview"]')!.dataset.paneDragging).toBe("true")
  fireEvent.pointerUp(grip, { pointerId: 2 })
  await act(async () => {})
  expect(drawnOrder(view.container)).toEqual(["preview", "browser", "chat"])
  expect(browser.dataset.paneDropTarget).toBeUndefined()
  expect(document.querySelector(".desktop-shell-drag-shield")).toBeNull()

  // A cancelled drag drops nothing.
  const chatGrip = view.getByRole("button", { name: "Move Chat" })
  Object.defineProperty(chatGrip, "setPointerCapture", { value: vi.fn() })
  bounds.preview = [0, 500]
  bounds.browser = [500, 1000]
  bounds.chat = [1000, 1500]
  fireEvent.pointerDown(chatGrip, { button: 0, clientX: 1250, pointerId: 3 })
  fireEvent.pointerMove(chatGrip, { clientX: 200, pointerId: 3 })
  fireEvent.pointerCancel(chatGrip, { pointerId: 3 })
  await act(async () => {})
  expect(drawnOrder(view.container)).toEqual(["preview", "browser", "chat"])

  // Escape drops a drag where it started; the release that follows moves nothing.
  fireEvent.pointerDown(chatGrip, { button: 0, clientX: 1250, pointerId: 4 })
  fireEvent.pointerMove(chatGrip, { clientX: 200, pointerId: 4 })
  expect(view.container.querySelector<HTMLElement>('[data-screen-panel="preview"]')!.dataset.paneDropTarget).toBe(
    "true"
  )
  fireEvent.keyDown(chatGrip, { key: "Escape" })
  await act(async () => {})
  expect(view.container.querySelector("[data-pane-drop-target]")).toBeNull()
  fireEvent.pointerUp(chatGrip, { pointerId: 4 })
  await act(async () => {})
  expect(drawnOrder(view.container)).toEqual(["preview", "browser", "chat"])
})

test("a divider on a pane's end edge widens it toward the end", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200)
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0)
    return 1
  })
  const view = render(
    <DesktopWorkspace
      navigation={null}
      initialNavigationPinned
      initialPaneOrder={["preview", "chat"]}
      panes={panes()}
    />
  )
  await act(async () => {})
  const preview = view.container.querySelector<HTMLElement>('[data-screen-panel="preview"]')!
  const divider = preview.querySelector<HTMLElement>(".desktop-shell-divider")!
  expect(divider.dataset.edge).toBe("end")
  Object.defineProperty(divider, "setPointerCapture", { value: vi.fn() })
  const before = Number.parseFloat(preview.style.width)
  fireEvent.pointerDown(divider, { button: 0, clientX: 500, pointerId: 1 })
  fireEvent.pointerMove(divider, { clientX: 530, pointerId: 1 })
  expect(document.querySelector<HTMLElement>(".desktop-shell-drag-shield")?.dataset.drag).toBe("divider")
  fireEvent.pointerUp(divider, { pointerId: 1 })
  expect(Number.parseFloat(preview.style.width)).toBe(before + 30)
  expect(document.querySelector(".desktop-shell-drag-shield")).toBeNull()
})
