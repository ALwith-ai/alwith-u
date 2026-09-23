import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react"
import { expect, spyOn, test } from "bun:test"
import { installDom } from "../codex/__tests__/dom-environment"
import * as openWithApp from "@/lib/open-with-app"
import * as preferences from "@/lib/preferences"
import { initI18n } from "@/lib/i18n"

installDom()
await initI18n("en")

test("main header preloads apps before opening its menu and remounts use the resolved list immediately", async () => {
  const apps = [{ name: "Visual Studio Code", bundle_id: "com.microsoft.VSCode", icon: null }]
  let finish!: (apps: openWithApp.AppInfo[]) => void
  const readAppsInfo = spyOn(openWithApp, "readAppsInfo").mockReturnValue(
    new Promise(resolve => {
      finish = resolve
    })
  )
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
    const { ChatActionsMenu } = await import("../chat-actions-menu")
    const { useExternalApps } = await import("../open-in-editor")
    const view = render(
      <ChatActionsMenu surface="main" cwd="/tmp/project" onNewChat={() => {}} onOpenWindow={() => {}} />
    )
    expect(view.queryByRole("menu")).toBeNull()
    await waitFor(() => expect(readAppsInfo).toHaveBeenCalledTimes(1))
    await act(async () => {
      finish(apps)
    })
    act(() => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    expect(view.getByRole("menuitem", { name: "Open", exact: true })).toBeDefined()
    act(() => {
      fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" })
    })
    act(() => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    expect(view.getByRole("menuitem", { name: "Open", exact: true })).toBeDefined()
    // This assertion runs before the cached Promise's continuation can update React state.
    const cached = renderHook(() => useExternalApps())
    expect(cached.result.current).toEqual(apps)
    expect(readAppsInfo).toHaveBeenCalledTimes(1)
    cached.unmount()
    view.unmount()
  } finally {
    readAppsInfo.mockRestore()
    loadPreferences.mockRestore()
  }
})

test("main chat menu uses installed app shortcuts, remembers the choice and opens its project", async () => {
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
    externalEditor: "com.microsoft.VSCode"
  })
  const savePreference = spyOn(preferences, "savePreference").mockResolvedValue()
  const openPathInApp = spyOn(openWithApp, "openPathInApp").mockResolvedValue()
  try {
    const { ChatActionsMenu } = await import("../chat-actions-menu")
    const view = render(
      <ChatActionsMenu surface="main" cwd="/tmp/project" onNewChat={() => {}} onOpenWindow={() => {}} />
    )
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    expect(view.queryByRole("menuitem", { name: "Open project folder" })).toBeNull()
    const open = await view.findByRole("menuitem", { name: "Open", exact: true })
    await act(async () => {
      fireEvent.click(open)
    })
    const app = await view.findByRole("menuitemradio", { name: "Visual Studio Code" })
    await act(async () => {
      fireEvent.click(app)
    })
    expect(openPathInApp).toHaveBeenCalledWith("com.microsoft.VSCode", "/tmp/project")
    expect(savePreference).toHaveBeenCalledWith("externalEditor", "com.microsoft.VSCode")
  } finally {
    readAppsInfo.mockRestore()
    loadPreferences.mockRestore()
    savePreference.mockRestore()
    openPathInApp.mockRestore()
  }
})
