import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { useState } from "react"
import { createPortal } from "react-dom"
import { useSidebarOverlay } from "@/components/alwith-ui/sidebar-overlay-context"
import { Button } from "@/components/ui/button"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { must } from "@/lib/__tests__/must"
import { initI18n } from "@/lib/i18n"
import * as preferences from "@/lib/preferences"
import { MainSidebarLayout } from "../main-sidebar-layout"

installDom()
await initI18n("en")

let save: ReturnType<typeof spyOn<typeof preferences, "savePreference">>
beforeEach(() => {
  save = spyOn(preferences, "savePreference").mockResolvedValue()
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

function setup(initialPinned = false) {
  const view = render(
    <MainSidebarLayout initialPinned={initialPinned} sidebar={<SidebarContent />}>
      <main data-testid="chat">Chat</main>
    </MainSidebarLayout>
  )
  return {
    ...view,
    toggle: view.getByRole("switch", { name: "Pin sidebar" }),
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
    await Bun.sleep(230)
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
