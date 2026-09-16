import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, test } from "bun:test"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"

installDom()

// Desktop's second case here (the CodexHoverCard portal geometry) is not ported: Base UI's
// portal only mounts when Base UI was first loaded with a DOM present, and in the shared
// bun test process the chat tests load it before any DOM is installed.
const { NavigationSessionItem } = await import("../navigation-session-item")

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

describe("NavigationSessionItem", () => {
  test("统一使用 Codex 导航会话行几何", () => {
    const screen = render(<NavigationSessionItem title="Session" />)

    expect(screen.getAllByText("Session")).toHaveLength(1)
    const row = screen.getByText("Session").closest("[data-slot=navigation-session-item]")!
    for (const cls of ["h-[var(--navigation-row-height)]", "rounded-[10px]", "ps-1", "pe-1.5", "gap-1", "items-center"])
      expect(row.classList.contains(cls)).toBe(true)
    const leading = row.querySelector("[data-slot=navigation-leading]")!
    for (const cls of ["size-6", "items-center", "justify-center"]) expect(leading.classList.contains(cls)).toBe(true)
  })
})
