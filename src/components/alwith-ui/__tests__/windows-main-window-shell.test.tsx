import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { zoomStore } from "@/lib/zoom"
import { WindowsMainWindowShell } from "../windows-main-window-shell"

const native = vi.hoisted(() => ({ os: "windows", tauri: true }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri }))
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => native.os }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string): string => key }) }))

beforeEach(() => {
  native.os = "windows"
  native.tauri = true
  zoomStore.setState({ level: 1 })
})
afterEach(cleanup)

test("Windows reserves plugin controls without drawing a second button set", () => {
  render(
    <WindowsMainWindowShell>
      <main>Content</main>
    </WindowsMainWindowShell>
  )
  const header = screen.getByRole("banner")
  expect(header).toHaveStyle({ height: "32px" })
  expect(header.style.paddingRight).toBe("var(--tauri-plugin-decoration-right-clearance, 0px)")
  expect(screen.getByText("app.name").parentElement).toHaveAttribute("data-tauri-drag-region")
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
  expect(screen.getByRole("main")).toHaveTextContent("Content")
})

test("plugin titlebar height follows page zoom", () => {
  zoomStore.setState({ level: 2 })
  render(
    <WindowsMainWindowShell>
      <main>Content</main>
    </WindowsMainWindowShell>
  )
  expect(screen.getByRole("banner")).toHaveStyle({ height: "16px" })
  expect(document.documentElement.style.getPropertyValue("--tauri-plugin-decoration-titlebar-height")).toBe("16px")
})

test.each(["macos", "linux"])("%s keeps the original content without a custom title bar", os => {
  native.os = os
  render(
    <WindowsMainWindowShell>
      <main>Content</main>
    </WindowsMainWindowShell>
  )
  expect(screen.getByRole("main")).toHaveTextContent("Content")
  expect(screen.queryByRole("banner")).not.toBeInTheDocument()
})

test("browser previews keep the original content", () => {
  native.tauri = false
  render(
    <WindowsMainWindowShell>
      <main>Content</main>
    </WindowsMainWindowShell>
  )
  expect(screen.queryByRole("banner")).not.toBeInTheDocument()
})
