import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { loadEditorSettings } from "../editor-settings"
import { EditorSettingsSection } from "../editor-settings-dialog"
import { useEditorPreferences } from "../use-editor-preferences"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let fixture: ReturnType<typeof settingsFixture>
beforeEach(() => {
  fixture = settingsFixture()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function WorkspaceObserver() {
  const { settings, iconTheme } = useEditorPreferences()
  return (
    <output data-testid="workspace-settings">
      {settings.fontSize}:{String(settings.wordWrap)}:{iconTheme}
    </output>
  )
}

test("settings page edits persist and update an already mounted workspace", async () => {
  render(
    <>
      <EditorSettingsSection />
      <WorkspaceObserver />
    </>
  )
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole("spinbutton", { name: "workspace.fontSize" }), { target: { value: "18" } })
  fireEvent.click(screen.getByRole("switch", { name: "workspace.wordWrap" }))
  await waitFor(() => expect(loadEditorSettings()).toMatchObject({ fontSize: 18, wordWrap: false }))
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
    fixture.changed({ "editor.fontSize": 22, "editor.iconTheme": "material-icon-theme" })
  })
  expect(screen.getByRole("spinbutton", { name: "workspace.fontSize" })).toHaveValue(22)
  expect(screen.getByTestId("workspace-settings")).toHaveTextContent("22:true:material-icon-theme")
})
