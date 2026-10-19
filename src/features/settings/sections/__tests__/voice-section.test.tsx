import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { VoiceSettingsSlots } from "@alwith/module-voice/react"
import { afterEach, expect, test, vi } from "vitest"
import { VoiceSection } from "../voice-section"

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }))
vi.mock("@/lib/open", () => ({ openExternal }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/features/voice/settings", () => ({
  loadVoiceSettings: vi.fn(),
  saveVoiceSettings: vi.fn(),
  saveVoiceCredential: vi.fn(),
  deleteVoiceCredential: vi.fn(),
  voiceProfiles: vi.fn()
}))
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
