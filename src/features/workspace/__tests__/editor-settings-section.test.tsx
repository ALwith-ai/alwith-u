import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { EditorSettingsSection } from "../editor-settings-dialog"
import { defaultEditorSettings, loadEditorSettings } from "../editor-settings"
import { useEditorPreferences } from "../use-editor-preferences"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => localStorage.clear())
afterEach(cleanup)

function WorkspaceObserver() {
  const { settings, iconTheme } = useEditorPreferences()
  return (
    <output data-testid="workspace-settings">
      {settings.fontSize}:{String(settings.wordWrap)}:{iconTheme}
    </output>
  )
}

test("settings page edits persist and update an already mounted workspace", () => {
  render(
    <>
      <EditorSettingsSection />
      <WorkspaceObserver />
    </>
  )
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole("spinbutton", { name: "workspace.fontSize" }), { target: { value: "18" } })
  fireEvent.click(screen.getByRole("switch", { name: "workspace.wordWrap" }))
  expect(loadEditorSettings()).toMatchObject({ fontSize: 18, wordWrap: false })
  expect(screen.getByTestId("workspace-settings")).toHaveTextContent("18:false:")
})

test("other-window preference events refresh both the settings controls and workspace", () => {
  render(
    <>
      <EditorSettingsSection />
      <WorkspaceObserver />
    </>
  )
  act(() => {
    localStorage.setItem("workspace:editor-settings", JSON.stringify({ ...defaultEditorSettings, fontSize: 22 }))
    localStorage.setItem("workspace:editor-icon-theme", JSON.stringify("material-icon-theme"))
    window.dispatchEvent(new StorageEvent("storage", { key: "workspace:editor-settings" }))
  })
  expect(screen.getByRole("spinbutton", { name: "workspace.fontSize" })).toHaveValue(22)
  expect(screen.getByTestId("workspace-settings")).toHaveTextContent("22:true:material-icon-theme")
})
