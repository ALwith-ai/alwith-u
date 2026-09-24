import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { useState } from "react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { MainSidebarLayout, type MainScreen } from "@/features/layout/components/main-sidebar-layout"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { ThreadSidebar } from "../thread-sidebar"

installDom()
await initI18n("en")
const originalState = client.state
afterEach(() => {
  cleanup()
  client.store.setState(originalState, true)
})

test("footer arrows switch screens, plugins are selected only on the leading screen, and new chat returns to main", async () => {
  client.store.setState({
    agent: { protocolVersion: 2, capabilities: { _meta: { codex: { plugins: true } } } }
  })
  function Harness() {
    const [screen, setScreen] = useState<MainScreen>("main")
    return (
      <MainSidebarLayout
        initialPinned
        screen={screen}
        leading={<main>Plugin content</main>}
        main={<main>Chat content</main>}
        sidebar={
          <ThreadSidebar
            screen={screen}
            selectedId={null}
            onSelect={() => setScreen("main")}
            onNewChat={() => setScreen("main")}
            onNewProjectChat={() => {}}
            onSearch={() => {}}
            onOpenWindow={() => {}}
            onOpenSettings={() => {}}
            onOpenPlugins={() => setScreen("leading")}
            onSwitchScreen={() => setScreen(screen === "main" ? "leading" : "main")}
          />
        }
      />
    )
  }
  const view = render(<Harness />)
  const plugins = view.getByRole("button", { name: "Plugins" })
  const arrow = view.getByRole("button", { name: "Open -1 screen" })
  expect(arrow.closest('[data-slot="sidebar-footer"]')).not.toBeNull()
  expect(arrow.querySelector(".lucide-arrow-left")).toBeTruthy()
  expect(arrow.classList.contains("justify-start")).toBe(true)
  expect(arrow.classList.contains("justify-end")).toBe(false)
  expect(plugins.hasAttribute("aria-current")).toBe(false)
  await act(async () => fireEvent.click(arrow))
  expect(plugins.getAttribute("aria-current")).toBe("page")
  expect(view.getByRole("button", { name: "Back to main screen" }).querySelector(".lucide-arrow-right")).toBeTruthy()
  expect(arrow.classList.contains("justify-end")).toBe(true)
  expect(arrow.classList.contains("justify-start")).toBe(false)
  expect(view.container.querySelector('[data-screen-panel="main"]')?.getAttribute("aria-hidden")).toBe("true")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Back to main screen" })))
  expect(view.getByRole("button", { name: "Open -1 screen" })).toBe(arrow)
  expect(arrow.classList.contains("justify-start")).toBe(true)
  expect(plugins.hasAttribute("aria-current")).toBe(false)
  await act(async () => fireEvent.click(plugins))
  expect(plugins.getAttribute("aria-current")).toBe("page")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "New chat" })))
  expect(view.getByRole("button", { name: "Open -1 screen" })).toBeTruthy()
  expect(plugins.hasAttribute("aria-current")).toBe(false)
})
