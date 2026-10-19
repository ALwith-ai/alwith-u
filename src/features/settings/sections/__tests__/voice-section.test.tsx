import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { settingsStore, type SettingsSnapshot } from "@/lib/settings-store"
import type { VoiceSettingsSlots } from "@alwith/module-voice/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { VoiceSection } from "../voice-section"

const { openExternal, reportError } = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  reportError: vi.fn()
}))
vi.mock("sonner", () => ({ toast: { error: reportError, success: vi.fn() } }))
vi.mock("@/lib/open", () => ({ openExternal }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/features/voice/settings", async importOriginal => ({
  ...(await importOriginal<typeof import("@/features/voice/settings")>()),
  loadVoiceSettings: vi.fn(),
  saveVoiceSettings: vi.fn(),
  saveVoiceCredential: vi.fn(),
  deleteVoiceCredential: vi.fn(),
  voiceProfiles: vi.fn()
}))
let fixture: ReturnType<typeof settingsFixture>
const changed = (value: boolean): void => fixture.changed({ "voice.enabled": value })
beforeEach(() => {
  fixture = settingsFixture()
})
vi.mock("@alwith/module-voice/react", () => ({
  VoiceSettingsForm: ({ slots }: { slots: VoiceSettingsSlots }) => {
    const KeyLink = slots.KeyLink
    if (KeyLink === undefined) throw new Error("missing_key_link_slot")
    return (
      <KeyLink href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank">
        Get API key
      </KeyLink>
    )
  }
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

test("voice is enabled by default and its topmost switch persists changes", async () => {
  const view = render(<VoiceSection />)
  const toggle = await screen.findByRole("switch", { name: "voice.enabled" })
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).toBeChecked()
  expect(
    toggle.compareDocumentPosition(screen.getByText("voice.shortcut")) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  await waitFor(() => expect(toggle).toBeEnabled())
  view.unmount()
  render(<VoiceSection />)
  await waitFor(() => expect(screen.getByRole("switch", { name: "voice.enabled" })).toBeEnabled())
  expect(screen.getByRole("switch", { name: "voice.enabled" })).not.toBeChecked()
  act(() => changed(true))
  expect(screen.getByRole("switch", { name: "voice.enabled" })).toBeChecked()
})

test("a late initial read does not overwrite a newer voice preference", async () => {
  let resolve!: (value: SettingsSnapshot) => void
  vi.mocked(settingsStore.read).mockImplementationOnce(
    () =>
      new Promise<SettingsSnapshot>(done => {
        resolve = done
      })
  )
  render(<VoiceSection />)
  await waitFor(() => expect(settingsStore.read).toHaveBeenCalled())
  await act(async () => {
    changed(false)
    resolve({ revision: 0, values: { "voice.enabled": true }, browserMigrated: true })
  })
  expect(screen.getByRole("switch", { name: "voice.enabled" })).not.toBeChecked()
})

test("a failed preference save reports the error and allows retrying", async () => {
  vi.mocked(settingsStore.write).mockRejectedValueOnce(new Error("disk full"))
  render(<VoiceSection />)
  const toggle = screen.getByRole("switch", { name: "voice.enabled" })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(reportError).toHaveBeenCalledWith("disk full"))
  expect(toggle).toBeEnabled()
  fireEvent.click(toggle)
  await waitFor(() => expect(settingsStore.write).toHaveBeenCalledTimes(2))
  expect(toggle).not.toBeChecked()
})

test("key links open once without reaching native plugin document handlers", () => {
  const nativeClick = vi.fn()
  document.body.addEventListener("click", nativeClick)
  try {
    render(<VoiceSection />)
    fireEvent.click(screen.getByRole("link", { name: "Get API key" }))
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("https://console.volcengine.com/speech/new/setting/apikeys")
    expect(nativeClick).not.toHaveBeenCalled()
  } finally {
    document.body.removeEventListener("click", nativeClick)
  }
})
