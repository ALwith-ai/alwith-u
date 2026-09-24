import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react"
import { expect, mock, spyOn, test } from "bun:test"
import { installDom } from "../codex/__tests__/dom-environment"
import * as openWithApp from "@/lib/open-with-app"
import * as preferences from "@/lib/preferences"
import { initI18n } from "@/lib/i18n"
import { setProjectAppPreference } from "@/lib/project-app-preference"
import { ProjectPathAction } from "@/features/threads/project-path-action"
import { useProjectApps } from "../open-in-editor"
import { must } from "@/lib/__tests__/must"

installDom()
await initI18n("en")

test("main header preloads apps before opening its menu and remounts use the resolved list immediately", async () => {
  const apps = [
    { name: "Visual Studio Code", bundle_id: "com.microsoft.VSCode", icon: "data:image/png;base64,aA==" },
    { name: "Finder", bundle_id: "com.apple.finder", icon: null }
  ]
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

function savedEditor(externalEditor: string | null): preferences.Preferences {
  return {
    lastProjectDirectory: null,
    language: null,
    zoomLevel: null,
    sessionModels: {},
    navigationSoundMode: "scale",
    navigationInstrument: "acoustic_grand_piano",
    externalEditor
  }
}

test("project and session shortcuts follow preference changes, display the app icon and keep their own cwd", async () => {
  const load = spyOn(preferences, "loadPreferences").mockResolvedValue(savedEditor("com.microsoft.VSCode"))
  const open = spyOn(openWithApp, "openPathInApp").mockResolvedValue()
  const save = spyOn(preferences, "savePreference").mockResolvedValue()
  const closed = mock(() => {})
  try {
    const view = render(
      <>
        <ProjectPathAction cwd="/projects/one" onOpened={closed} />
        <ProjectPathAction cwd="/projects/two" onOpened={closed} appearance="session" />
      </>
    )
    await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(2))
    const buttons = view.getAllByRole("button", { name: "Open project folder" })
    expect(buttons[0]?.title).toContain("Visual Studio Code")
    await act(async () => {
      fireEvent.click(must(buttons[0], "project shortcut"))
    })
    expect(open).toHaveBeenLastCalledWith("com.microsoft.VSCode", "/projects/one")
    load.mockResolvedValue(savedEditor("com.apple.finder"))
    act(() => setProjectAppPreference("com.apple.finder"))
    expect(buttons[1]?.title).toContain("Finder")
    expect(view.container.querySelectorAll("img")).toHaveLength(0)
    await act(async () => {
      fireEvent.click(must(buttons[1], "session shortcut"))
    })
    expect(open).toHaveBeenLastCalledWith("com.apple.finder", "/projects/two")
    expect(closed).toHaveBeenCalledTimes(2)
    expect(save).not.toHaveBeenCalled()
  } finally {
    load.mockRestore()
    open.mockRestore()
    save.mockRestore()
  }
})

test("floating shortcut uses the saved application and shows its icon", async () => {
  const load = spyOn(preferences, "loadPreferences").mockResolvedValue(savedEditor("com.microsoft.VSCode"))
  const open = spyOn(openWithApp, "openPathInApp").mockResolvedValue()
  try {
    const { ChatActionsMenu } = await import("../chat-actions-menu")
    const view = render(<ChatActionsMenu surface="floating" cwd="/projects/floating" onNewChat={() => {}} />)
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "More actions" }))
    })
    const shortcut = view.getByRole("menuitem", { name: "Open project folder" })
    expect(shortcut.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aA==")
    await act(async () => {
      fireEvent.click(shortcut)
    })
    expect(open).toHaveBeenCalledWith("com.microsoft.VSCode", "/projects/floating")
  } finally {
    load.mockRestore()
    open.mockRestore()
  }
})

test("click uses the latest saved preference and refuses to silently substitute a missing app", async () => {
  const load = spyOn(preferences, "loadPreferences").mockResolvedValue(savedEditor("com.microsoft.VSCode"))
  const open = spyOn(openWithApp, "openPathInApp").mockResolvedValue()
  try {
    const hook = renderHook(() => useProjectApps("/projects/latest"))
    await act(async () => {})
    load.mockResolvedValue(savedEditor("com.apple.finder"))
    await act(async () => {
      await hook.result.current.openPreferred()
    })
    expect(open).toHaveBeenLastCalledWith("com.apple.finder", "/projects/latest")
    load.mockResolvedValue(savedEditor("missing.app"))
    await expect(hook.result.current.openPreferred()).rejects.toThrow("preferred app is unavailable")
    expect(open).toHaveBeenCalledTimes(1)
  } finally {
    load.mockRestore()
    open.mockRestore()
  }
})
