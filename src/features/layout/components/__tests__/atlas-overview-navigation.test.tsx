import { NavigationScreenSwitch } from "@alwith/module-chat/session-list"
import { DesktopWorkspace } from "@alwith/module-desktop-shell/react"
import type { AtlasController } from "@nyssance/atlas/dom"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
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
