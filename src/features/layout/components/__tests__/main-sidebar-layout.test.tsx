import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { createPortal } from "react-dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { Button } from "@/components/ui/button"
import { must } from "@/lib/__tests__/must"
import { initI18n } from "@/lib/i18n"
import * as preferences from "@/lib/preferences"
import { type MainScreen, MainSidebarLayout } from "../main-sidebar-layout"

await initI18n("en")

let save: ReturnType<typeof spyOn<typeof preferences, "savePreference">>
beforeEach(() => {
  save = vi.spyOn(preferences, "savePreference").mockResolvedValue()
})
afterEach(() => {
  cleanup()
  save.mockRestore()
})

function SidebarContent() {
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  useSidebarOverlay(open)
  return (
    <>
      <Button onClick={() => setCount(value => value + 1)}>Count {count}</Button>
      <Button onClick={() => setOpen(true)}>Menu</Button>
      <div data-testid="list" style={{ overflow: "auto", height: 100 }}>
        <div style={{ height: 1000 }}>Scrollable threads</div>
      </div>
      {open &&
        createPortal(
          <div data-testid="portal">
            <Button onClick={() => setOpen(false)}>Close menu</Button>
          </div>,
          document.body
        )}
    </>
  )
}

function ChatContent() {
  const [draft, setDraft] = useState("")
  return (
    <main data-testid="chat">
      <textarea aria-label="Draft" value={draft} onInput={event => setDraft(event.currentTarget.value)} />
      <div data-testid="chat-scroll" style={{ overflow: "auto", height: 100 }}>
        <div style={{ height: 1000 }}>History</div>
      </div>
    </main>
  )
}

function setup(initialPinned = false, initialScreen: MainScreen = "main") {
  const layout = (screen: MainScreen) => (
    <MainSidebarLayout
      initialPinned={initialPinned}
      screen={screen}
      sidebar={<SidebarContent />}
      leading={<main data-testid="plugins">Plugins</main>}
      main={<ChatContent />}
    />
  )
  const view = render(layout(initialScreen))
  return {
    ...view,
    showScreen: (screen: MainScreen) => view.rerender(layout(screen)),
    toggle: view.getByRole("switch"),
    panel: must(view.container.querySelector<HTMLElement>(".main-sidebar-panel"), "sidebar panel"),
    viewport: must(view.container.querySelector<HTMLElement>(".main-sidebar-viewport"), "sidebar viewport"),
    shell: must(view.container.querySelector<HTMLElement>(".main-sidebar-shell"), "sidebar shell"),
    mode: () => view.container.querySelector("[data-sidebar-mode]")?.getAttribute("data-sidebar-mode"),
    presentation: () =>
      view.container.querySelector("[data-sidebar-presentation]")?.getAttribute("data-sidebar-presentation")
  }
}

async function afterCloseDelay() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 230))
  })
}

test("starts collapsed; edge hover previews without saving and closes after the delay", async () => {
  const view = setup()
  expect(view.mode()).toBe("hidden")
  expect(view.panel.hasAttribute("inert")).toBe(true)
  const edge = must(view.container.querySelector(".main-sidebar-edge"), "left edge")
  fireEvent.pointerOver(edge, { pointerType: "mouse" })
  expect(view.mode()).toBe("floating")
  expect(view.panel.hasAttribute("inert")).toBe(false)
  fireEvent.pointerOut(edge, { relatedTarget: view.getByTestId("chat") })
  expect(view.mode()).toBe("floating")
  await afterCloseDelay()
  expect(view.mode()).toBe("hidden")
  expect(view.presentation()).toBe("floating")
  expect(save).not.toHaveBeenCalled()
})

test("hovering the switch previews and entering the panel cancels pending close", async () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle, { pointerType: "mouse" })
  expect(view.mode()).toBe("floating")
  fireEvent.pointerOut(view.toggle, { relatedTarget: view.getByTestId("chat") })
  fireEvent.pointerOver(view.panel, { pointerType: "mouse" })
  await afterCloseDelay()
  expect(view.mode()).toBe("floating")
  expect(save).not.toHaveBeenCalled()
})

test("click pins and persists; leaving a pinned sidebar neither hides it nor steals focus", async () => {
  const view = setup()
  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("pinned")
  expect(view.presentation()).toBe("docked")
  expect(view.toggle.getAttribute("aria-checked")).toBe("true")
  expect(save).toHaveBeenLastCalledWith("sidebarPinned", true)
  const count = view.getByRole("button", { name: "Count 0" })
  act(() => count.focus())
  fireEvent.pointerOver(view.panel)
  fireEvent.pointerOut(view.panel, { relatedTarget: view.getByTestId("chat") })
  await afterCloseDelay()
  expect(view.mode()).toBe("pinned")
  expect(document.activeElement).toBe(count)
  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("hidden")
  expect(view.presentation()).toBe("docked")
  expect(view.panel.hasAttribute("inert")).toBe(true)
  expect(save).toHaveBeenLastCalledWith("sidebarPinned", false)
})

test("restores a saved pinned preference without rewriting it", () => {
  const view = setup(true)
  expect(view.mode()).toBe("pinned")
  expect(view.toggle.querySelector(".lucide-panel-left")).toBeTruthy()
  expect(view.container.querySelector(".main-sidebar-edge")).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

test("solid and dashed sidebar icons follow the pin preference, not the temporary hover preview", async () => {
  const view = setup()
  expect(view.toggle.querySelector(".lucide-panel-left-dashed")).toBeTruthy()
  fireEvent.pointerOver(view.toggle)
  expect(view.mode()).toBe("floating")
  expect(view.toggle.querySelector(".lucide-panel-left-dashed")).toBeTruthy()
  expect(view.toggle.querySelector(".lucide-panel-left")).toBeNull()
  expect(save).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(view.toggle))
  expect(view.toggle.querySelector(".lucide-panel-left")).toBeTruthy()
  expect(view.toggle.querySelector(".lucide-panel-left-dashed")).toBeNull()
  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("hidden")
  expect(view.toggle.querySelector(".lucide-panel-left-dashed")).toBeTruthy()
})

test("collapsing preserves the sidebar instance, local state and scroll position", async () => {
  const view = setup(true)
  const list = view.getByTestId("list")
  list.scrollTop = 180
  fireEvent.click(view.getByRole("button", { name: "Count 0" }))
  await act(async () => fireEvent.click(view.toggle))
  fireEvent.pointerOver(view.toggle)
  expect(view.getByTestId("list")).toBe(list)
  expect(list.scrollTop).toBe(180)
  expect(view.getByRole("button", { name: "Count 1" })).toBeTruthy()
})

test("Escape and outside presses close only the temporary preview", () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle)
  const count = view.getByRole("button", { name: "Count 0" })
  act(() => count.focus())
  fireEvent.keyDown(count, { key: "Escape" })
  expect(view.mode()).toBe("hidden")
  expect(document.activeElement).toBe(view.toggle)
  fireEvent.pointerOver(view.toggle)
  fireEvent.pointerDown(view.getByTestId("chat"))
  expect(view.mode()).toBe("hidden")
  expect(save).not.toHaveBeenCalled()
})

test("portalled sidebar menus retain the preview and their clicks are not outside presses", async () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle)
  fireEvent.click(view.getByRole("button", { name: "Menu" }))
  fireEvent.pointerOut(view.toggle, { relatedTarget: view.getByTestId("chat") })
  await afterCloseDelay()
  expect(view.mode()).toBe("floating")
  fireEvent.pointerDown(view.getByTestId("portal"))
  fireEvent.keyDown(view.getByTestId("portal"), { key: "Escape" })
  expect(view.mode()).toBe("floating")
  fireEvent.click(view.getByRole("button", { name: "Close menu" }))
  await afterCloseDelay()
  expect(view.mode()).toBe("hidden")
})

test("touch does not trigger hover preview", () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle, { pointerType: "touch" })
  expect(view.mode()).toBe("hidden")
})

test("switching between floating and docked animations retains the viewport and sidebar state", async () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle)
  fireEvent.click(view.getByRole("button", { name: "Count 0" }))
  expect(view.presentation()).toBe("floating")
  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("pinned")
  expect(view.presentation()).toBe("docked")
  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("hidden")
  expect(view.presentation()).toBe("docked")
  fireEvent.pointerOver(view.toggle)
  expect(view.mode()).toBe("floating")
  expect(view.presentation()).toBe("floating")
  expect(view.container.querySelector(".main-sidebar-viewport")).toBe(view.viewport)
  expect(view.container.querySelector(".main-sidebar-panel")).toBe(view.panel)
  expect(view.getByRole("button", { name: "Count 1" })).toBeTruthy()
})

test("reopening during fade-out cancels pending close and does not persist a hover state", async () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle)
  fireEvent.pointerOut(view.toggle, { relatedTarget: view.getByTestId("chat") })
  await afterCloseDelay()
  // The logical state is hidden while CSS is still painting the 150ms exit.
  expect(view.mode()).toBe("hidden")
  expect(view.panel.hasAttribute("inert")).toBe(true)
  fireEvent.pointerOver(view.toggle)
  await afterCloseDelay()
  expect(view.mode()).toBe("floating")
  expect(view.panel.hasAttribute("inert")).toBe(false)
  expect(save).not.toHaveBeenCalled()
})

test("rapid pin reversals keep the last choice and serialize preference writes", async () => {
  const view = setup()
  // Separate input events commit separately, still well inside the 200ms animation.
  for (let index = 0; index < 3; index += 1) await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("pinned")
  expect(view.presentation()).toBe("docked")
  expect(save.mock.calls).toEqual([
    ["sidebarPinned", true],
    ["sidebarPinned", false],
    ["sidebarPinned", true]
  ])
})

test("leading screen starts with a docked right sidebar and ignores hover, outside clicks and Escape", async () => {
  const view = setup(false, "leading")
  expect(view.mode()).toBe("pinned")
  expect(view.presentation()).toBe("docked")
  expect(view.toggle.querySelector(".lucide-panel-right")).toBeTruthy()
  expect(view.container.querySelector(".main-sidebar-edge")).toBeNull()
  fireEvent.pointerOut(view.panel, { relatedTarget: view.getByTestId("plugins") })
  fireEvent.keyDown(view.toggle, { key: "Escape" })
  fireEvent.pointerDown(view.getByTestId("plugins"))
  await afterCloseDelay()
  expect(view.mode()).toBe("pinned")

  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("hidden")
  expect(view.presentation()).toBe("docked")
  expect(view.toggle.querySelector(".lucide-panel-right-dashed")).toBeTruthy()
  fireEvent.pointerOver(view.toggle)
  fireEvent.pointerOver(view.shell)
  await afterCloseDelay()
  expect(view.mode()).toBe("hidden")
  expect(view.panel.hasAttribute("inert")).toBe(true)
  expect(save).not.toHaveBeenCalled()

  await act(async () => fireEvent.click(view.toggle))
  expect(view.mode()).toBe("pinned")
  expect(view.panel.hasAttribute("inert")).toBe(false)
  expect(save).not.toHaveBeenCalled()
})

test.each([false, true])(
  "screen switches preserve the main preference (%p) and the independent right sidebar choice",
  async pinned => {
    const view = setup(pinned)
    view.showScreen("leading")
    expect(view.mode()).toBe("pinned")
    await act(async () => fireEvent.click(view.toggle))
    expect(view.mode()).toBe("hidden")
    view.showScreen("main")
    expect(view.mode()).toBe(pinned ? "pinned" : "hidden")
    expect(view.toggle.getAttribute("aria-checked")).toBe(String(pinned))
    view.showScreen("leading")
    expect(view.mode()).toBe("hidden")
    expect(view.toggle.querySelector(".lucide-panel-right-dashed")).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  }
)

test("entering the leading screen clears the hover timer and returning restores edge hover", async () => {
  const view = setup()
  fireEvent.pointerOver(view.toggle)
  fireEvent.pointerOut(view.toggle, { relatedTarget: view.getByTestId("chat") })
  view.showScreen("leading")
  await afterCloseDelay()
  expect(view.mode()).toBe("pinned")
  view.showScreen("main")
  expect(view.mode()).toBe("hidden")
  const edge = must(view.container.querySelector(".main-sidebar-edge"), "left edge")
  fireEvent.pointerOver(edge)
  expect(view.mode()).toBe("floating")
  fireEvent.pointerOut(edge, { relatedTarget: view.getByTestId("chat") })
  await afterCloseDelay()
  expect(view.mode()).toBe("hidden")
  expect(save).not.toHaveBeenCalled()
})

test("switching screens keeps the same sidebar, chat draft and scroll nodes, with only the visible screen interactive", () => {
  const view = setup(true)
  const draft = view.getByRole("textbox", { name: "Draft" }) as HTMLTextAreaElement
  const chatScroll = view.getByTestId("chat-scroll")
  const sidebarScroll = view.getByTestId("list")
  const mainPanel = must(view.container.querySelector('[data-screen-panel="main"]'), "main screen")
  const leadingPanel = must(view.container.querySelector('[data-screen-panel="leading"]'), "leading screen")
  fireEvent.input(draft, { target: { value: "Unsent draft" } })
  expect(draft.value).toBe("Unsent draft")
  chatScroll.scrollTop = 120
  sidebarScroll.scrollTop = 180
  fireEvent.click(view.getByRole("button", { name: "Count 0" }))

  view.showScreen("leading")
  expect(mainPanel.hasAttribute("inert")).toBe(true)
  expect(mainPanel.getAttribute("aria-hidden")).toBe("true")
  expect(leadingPanel.hasAttribute("inert")).toBe(false)
  expect(view.queryByRole("textbox", { name: "Draft" })).toBeNull()
  expect(view.getByRole("button", { name: "Count 1" })).toBeTruthy()
  view.showScreen("main")
  expect(view.getByRole("textbox", { name: "Draft" })).toBe(draft)
  expect(draft.value).toBe("Unsent draft")
  expect(view.getByTestId("chat-scroll")).toBe(chatScroll)
  expect(chatScroll.scrollTop).toBe(120)
  expect(view.getByTestId("list")).toBe(sidebarScroll)
  expect(sidebarScroll.scrollTop).toBe(180)
  expect(mainPanel.hasAttribute("inert")).toBe(false)
  expect(leadingPanel.getAttribute("aria-hidden")).toBe("true")
  expect(view.container.querySelector(".main-sidebar-panel")).toBe(view.panel)
})

test("returning to a collapsed main sidebar moves focus from its now hidden controls to the top switch", () => {
  const view = setup(false, "leading")
  act(() => view.getByRole("button", { name: "Count 0" }).focus())
  view.showScreen("main")
  expect(view.mode()).toBe("hidden")
  expect(document.activeElement).toBe(view.toggle)
})
