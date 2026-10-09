import { afterEach, expect, spyOn, test } from "bun:test"
import * as core from "@tauri-apps/api/core"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { useUpdaterStore } from "@/features/updater/store"
import { initI18n } from "@/lib/i18n"
import * as bridge from "@/lib/settings-bridge"
import { installDom } from "../../../chat/codex/__tests__/dom-environment"
import { AboutSection } from "../about-section"

installDom()
await initI18n("en")

afterEach(() => clearMocks())

test("About shows the installed app and executable versions instead of the ACP adapter version", async () => {
  const native = spyOn(core, "isTauri").mockReturnValue(true)
  const init = spyOn(useUpdaterStore.getState(), "init").mockResolvedValue()
  const agent = spyOn(bridge, "useSettingsAgent").mockReturnValue({
    name: "Codex",
    version: "0.7.4",
    authMethods: [],
    actions: []
  })
  mockIPC(command => {
    if (command === "plugin:app|version") return "0.2.0"
    if (command === "codex_version") return "0.159.2"
    throw new Error(`Unexpected command: ${command}`)
  })
  const view = render(<AboutSection />)
  try {
    await waitFor(() => {
      expect(view.getByText("Up to date v0.2.0")).toBeDefined()
      expect(view.getByText("Codex CLI 0.159.2")).toBeDefined()
    })
    expect(view.queryByText("Codex 0.7.4")).toBeNull()
    expect(view.queryByText("Version", { exact: true })).toBeNull()
  } finally {
    view.unmount()
    native.mockRestore()
    init.mockRestore()
    agent.mockRestore()
  }
})

test("a failed Codex version check reports the error and still displays the app version", async () => {
  const native = spyOn(core, "isTauri").mockReturnValue(true)
  const init = spyOn(useUpdaterStore.getState(), "init").mockResolvedValue()
  const error = spyOn(toast, "error").mockImplementation(() => "error-toast")
  mockIPC(
    command => {
      if (command === "plugin:app|version") return "0.2.0"
      if (command === "codex_version") throw new Error("Codex version check failed")
      return undefined
    },
    { shouldMockEvents: true }
  )
  const view = render(<AboutSection />)
  try {
    await act(async () => {})
    await waitFor(() => expect(view.getByText("Up to date v0.2.0")).toBeDefined())
    expect(view.getByText("Codex CLI —")).toBeDefined()
    expect(error).toHaveBeenCalledWith("Codex version check failed")
  } finally {
    view.unmount()
    native.mockRestore()
    init.mockRestore()
    error.mockRestore()
  }
})
