import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { type ReactElement, useContext } from "react"
import { createPortal } from "react-dom"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { zoomStore } from "@/lib/zoom"

import { WindowsExtensionControlsContext, WindowsMainWindowShell } from "../windows-main-window-shell"

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

test.each(["windows", "macos"])("%s routes extension actions to the appropriate toolbar", os => {
  native.os = os
  const activate = vi.fn()
  function ExtensionAction(): ReactElement {
    const target = useContext(WindowsExtensionControlsContext)
    const button = (
      <button type="button" onClick={activate}>
        Extension
      </button>
    )
    return target ? createPortal(button, target) : <main>{button}</main>
  }
  render(
    <WindowsMainWindowShell>
      <ExtensionAction />
    </WindowsMainWindowShell>
  )
  const button = screen.getByRole("button", { name: "Extension" })
  if (os === "windows") {
    expect(screen.getByRole("banner")).toContainElement(button)
    expect(button.closest(".windows-extension-controls")).not.toBeNull()
  } else {
    expect(screen.getByRole("main")).toContainElement(button)
    expect(screen.queryByRole("banner")).not.toBeInTheDocument()
  }
  fireEvent.click(button)
  expect(activate).toHaveBeenCalledOnce()
})

test("Windows reserves plugin controls without drawing a second button set", () => {
  render(
    <WindowsMainWindowShell>
      <main>Content</main>
    </WindowsMainWindowShell>
  )
  const header = screen.getByRole("banner")
  expect(header).toHaveStyle({ height: "32px" })
  expect(header.style.paddingRight).toBe("var(--tauri-plugin-decoration-right-clearance, 0px)")
  const logo = screen.getByRole("img", { name: "app.name" })
  expect(logo).toHaveStyle({ width: "24px", height: "24px" })
  expect(logo).toHaveAttribute("draggable", "false")
  expect(logo.parentElement).toHaveAttribute("data-tauri-drag-region")
  expect(logo.parentElement).toHaveAttribute("title", "app.name")
  expect(screen.queryByText("app.name")).not.toBeInTheDocument()
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
  expect(screen.getByRole("img", { name: "app.name" })).toHaveStyle({ width: "12px", height: "12px" })
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
