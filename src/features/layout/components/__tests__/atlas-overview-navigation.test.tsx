import { NavigationScreenSwitch } from "@alwith/module-chat/session-list"
import {
  DesktopTitleBarContext,
  DesktopWorkspace,
  DesktopWorkspaceControlsContext
} from "@alwith/module-desktop-shell/react"
import type { AtlasController } from "@nyssance/atlas/dom"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { SessionListHostProvider } from "@/features/sessions/session-list-host"
import { initI18n } from "@/lib/i18n"

const observed = vi.hoisted(() => ({ api: null as AtlasController | null }))
vi.mock("@nyssance/atlas/react", async (original) => {
  const actual = await original<typeof import("@nyssance/atlas/react")>()
  return {
    ...actual,
    useAtlas(options: Parameters<typeof actual.useAtlas>[0]) {
      const result = actual.useAtlas(options)
      observed.api = result.atlas
      return result
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockGeometry() {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.style.width.startsWith("calc(")) return 956
    return Number.parseFloat(this.style.width) || (this.hasAttribute("data-atlas-region") ? 0 : 1200)
  })
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute("data-atlas-region")) return 0
    let left = 0
    for (let node = this.previousElementSibling; node; node = node.previousElementSibling) {
      left += (node as HTMLElement).offsetWidth
    }
    return left
  })
}

test("the first overview selection enables the leading page and its arrow returns to main", async () => {
  await initI18n("en")
  mockGeometry()
  const clicked = vi.fn()
  function Harness() {
    const [screen, setScreen] = useState<"main" | "leading">("main")
    return (
      <DesktopWorkspace
        screen={screen}
        onScreenChange={setScreen}
        leading={<button onClick={clicked}>Leading action</button>}
        navigation={
          <SessionListHostProvider>
            <NavigationScreenSwitch screen={screen} onSwitch={() => setScreen("main")} />
          </SessionListHostProvider>
        }
        panes={[{ id: "chat", title: "Chat", children: <div>Chat</div>, min: 420 }]}
      />
    )
  }
  const view = render(<Harness />)
  await act(async () => {})
  const api = observed.api!
  act(() => {
    for (const node of api.getGeometry().regions) node.style.marginRight = "0px"
    api.refresh()
  })
  const leading = view.container.querySelector('[data-screen-panel="leading"]')!
  expect(leading).toHaveAttribute("inert")
  fireEvent.doubleClick(view.container.querySelector(".main-window-statusbar")!)
  const target = view.container.querySelector('[data-atlas-overview-target="leading"]')!
  expect(target).not.toBeNull()
  fireEvent.click(target)
  expect(api.overview.getState()).toBeNull()
  expect(api.getState().activeRegion).toBe("leading")
  expect(leading).not.toHaveAttribute("inert")
  expect(leading).toHaveAttribute("aria-hidden", "false")
  fireEvent.click(view.getByRole("button", { name: "Leading action" }))
  expect(clicked).toHaveBeenCalledOnce()
  const back = view.getByRole("button", { name: "Back to main screen" })
  expect(back.querySelector(".lucide-arrow-right")).not.toBeNull()
  fireEvent.click(back)
  expect(view.getByRole("button", { name: "Open -1 screen" })).toBeInTheDocument()
  expect(leading).toHaveAttribute("inert")
})

test.each([false, true])("shell owns toolbar visibility across screens with a native host: %s", async (nativeHost) => {
  await initI18n("en")
  mockGeometry()
  const target = document.createElement("div")
  document.body.append(target)
  function Harness() {
    const [screen, setScreen] = useState<"main" | "leading">("main")
    return (
      <DesktopWorkspaceControlsContext.Provider value={nativeHost ? target : null}>
        <DesktopWorkspace
          screen={screen}
          onScreenChange={setScreen}
          navigation={null}
          leading={<div>Management</div>}
          panes={[{ id: "chat", title: "Chat", children: <div>Chat</div>, min: 420 }]}
          trailing={<div>Lounge</div>}
          toolbar={<button type="button">Workspace actions</button>}
        />
      </DesktopWorkspaceControlsContext.Provider>
    )
  }
  try {
    const view = render(<Harness />)
    await act(async () => {})
    const api = observed.api!
    act(() => {
      for (const node of api.getGeometry().regions) node.style.marginRight = "0px"
      api.refresh()
    })
    for (const region of ["trailing", "leading", "trailing", "chat"] as const) {
      fireEvent.doubleClick(view.container.querySelector(".main-window-statusbar")!)
      fireEvent.click(view.container.querySelector(`[data-atlas-overview-target="${region}"]`)!)
      expect(api.getState().activeRegion).toBe(region)
      if (region === "leading") {
        expect(view.queryByRole("button", { name: "Workspace actions" })).not.toBeInTheDocument()
        expect(target).toBeEmptyDOMElement()
      } else {
        const host = nativeHost ? target : view.getByRole("banner")
        expect(host).toContainElement(view.getByRole("button", { name: "Workspace actions" }))
        expect(view.getAllByRole("button", { name: "Workspace actions" })).toHaveLength(1)
      }
    }
    view.unmount()
  } finally {
    target.remove()
  }
})

test.each([
  { nativeHost: false, pinned: false },
  { nativeHost: false, pinned: true },
  { nativeHost: true, pinned: false },
  { nativeHost: true, pinned: true }
])("shell returns home and opens navigation from extra screens: %j", async ({ nativeHost, pinned }) => {
  mockGeometry()
  const target = document.createElement("div")
  document.body.append(target)
  const save = vi.fn()
  const view = render(
    <DesktopTitleBarContext.Provider value={nativeHost ? target : null}>
      <DesktopWorkspace
        initialNavigationPinned={pinned}
        onNavigationPinnedChange={save}
        navigation={<div>Navigation</div>}
        panes={[
          { id: "chat", title: "Chat", children: <div>Chat</div>, min: 420 },
          { id: "preview", title: "Preview", children: <div>Preview</div>, min: 420 }
        ]}
        trailing={<div>Lounge</div>}
        labels={{ pin: "Open sidebar", unpin: "Close sidebar" }}
      />
    </DesktopTitleBarContext.Provider>
  )
  try {
    await act(async () => {})
    const api = observed.api!
    act(() => {
      for (const node of api.getGeometry().regions) node.style.marginRight = "0px"
      api.refresh()
    })
    for (const region of ["trailing", "preview", "trailing"] as const) {
      fireEvent.doubleClick(view.container.querySelector(".main-window-statusbar")!)
      fireEvent.click(view.container.querySelector(`[data-atlas-overview-target="${region}"]`)!)
      expect(api.getState().activeRegion).toBe(region)
      const toggle = view.getByRole("switch", { name: "Open sidebar" })
      expect(toggle).toHaveAttribute("title", "Open sidebar")
      expect(toggle).toHaveAttribute("aria-checked", "false")
      expect(toggle).toHaveAttribute("aria-expanded", "false")
      expect(toggle.querySelector(".lucide-panel-left-dashed")).not.toBeNull()
      if (nativeHost) expect(target).toContainElement(toggle)
      fireEvent.click(toggle)
      await waitFor(() => expect(api.getState().activeRegion).toBe("chat"))
      await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))
      expect(toggle).toHaveAttribute("aria-label", "Close sidebar")
      expect(toggle).toHaveAttribute("aria-expanded", "true")
      expect(toggle.querySelector(".lucide-panel-left")).not.toBeNull()
      expect(view.container.querySelector("[data-sidebar-mode]")).toHaveAttribute("data-sidebar-mode", "pinned")
      expect(save).toHaveBeenLastCalledWith(true)
      fireEvent.click(toggle)
      await waitFor(() => expect(save).toHaveBeenLastCalledWith(false))
      expect(toggle).toHaveAttribute("aria-checked", "false")
    }
  } finally {
    view.unmount()
    target.remove()
  }
})
