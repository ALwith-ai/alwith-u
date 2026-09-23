import { addPrompt, applyUpdate, createSession } from "@alwith/api"
import { render, waitFor } from "@testing-library/react"
import { afterEach, expect, mock, test } from "bun:test"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
mock.module("@tauri-apps/plugin-log", () => ({ info: async () => {} }))
const { ThreadView } = await import("../thread-view")
const { navigationSoundStore } = await import("../codex/navigation-sound-store")
await initI18n("en")
navigationSoundStore.setState({ soundMode: "none" })
const originalRect = HTMLElement.prototype.getBoundingClientRect
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight)
})

test("completed answer releases the temporary turn anchor space", async () => {
  const first = applyUpdate(
    addPrompt(createSession("anchor-space", "/tmp"), [{ type: "text", text: "first" }], "first"),
    { sessionUpdate: "state_update", state: "idle" } as never
  )
  const second = addPrompt(first, [{ type: "text", text: "second" }], "second")
  const running = applyUpdate(second, { sessionUpdate: "state_update", state: "running" } as never)
  const view = render(
    <ThemeProvider>
      <ThreadView session={first} />
    </ThemeProvider>
  )
  const viewport = view.getByRole("log")
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 300 },
    scrollTo: { configurable: true, value: () => {} }
  })
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-codex-turn")) return { ...originalRect.call(this), top: 400 } as DOMRect
    return originalRect.call(this)
  }
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.hasAttribute("data-turn-key") ? 80 : 0
    }
  })
  await waitFor(() => expect(viewport.querySelectorAll("[data-codex-turn]")).toHaveLength(1))
  view.rerender(
    <ThemeProvider>
      <ThreadView session={running} />
    </ThemeProvider>
  )
  const spacer = viewport.querySelector<HTMLElement>("[style*='transition: height']")
  expect(spacer).not.toBeNull()
  await waitFor(() => expect(Number.parseFloat(spacer?.style.height ?? "0")).toBeGreaterThan(0))

  const completed = applyUpdate(running, { sessionUpdate: "state_update", state: "idle" } as never)
  view.rerender(
    <ThemeProvider>
      <ThreadView session={completed} />
    </ThemeProvider>
  )
  expect(spacer?.style.height).toBe("0px")
})
