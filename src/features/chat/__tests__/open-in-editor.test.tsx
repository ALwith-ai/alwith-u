import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { expect, spyOn, test } from "bun:test"
import { installDom } from "../codex/__tests__/dom-environment"
import * as openWithApp from "@/lib/open-with-app"
import * as preferences from "@/lib/preferences"
import { initI18n } from "@/lib/i18n"

installDom()
await initI18n("en")

test("project menu opens its labelled application group", async () => {
  const readAppsInfo = spyOn(openWithApp, "readAppsInfo").mockResolvedValue([
    { name: "Visual Studio Code", bundle_id: "com.microsoft.VSCode", icon: null }
  ])
  const loadPreferences = spyOn(preferences, "loadPreferences").mockResolvedValue({
    lastProjectDirectory: null,
    language: null,
    zoomLevel: null,
    sessionModels: {},
    navigationSoundMode: "scale",
    navigationInstrument: "acoustic_grand_piano",
    externalEditor: null
  })
  try {
    const { ProjectMenu } = await import("../open-in-editor")
    const view = render(<ProjectMenu cwd="/Users/finture/Desktop" />)

    await waitFor(() => expect(readAppsInfo).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Desktop/ }))
    })

    const label = view.getByText("Open in")
    expect(label.closest('[role="group"]')).not.toBeNull()
    expect(view.getByRole("menuitemradio", { name: "Visual Studio Code" })).toBeDefined()
  } finally {
    readAppsInfo.mockRestore()
    loadPreferences.mockRestore()
  }
})
