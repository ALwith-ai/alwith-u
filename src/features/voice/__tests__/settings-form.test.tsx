import { defaultPreferences, type Provider } from "@alwith/module-voice"
import { VoiceSettingsForm, type VoiceSettingsHost, type VoiceSettingsSlots } from "@alwith/module-voice/react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"
import { VoiceSection } from "@/features/settings/sections/voice-section"
import { settingsFixture } from "@/lib/__tests__/settings-fixture"
const notice = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast: notice }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const slots: VoiceSettingsSlots = {
  Group: ({ children }) => <div>{children}</div>,
  Row: ({ title, children }) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  Button: (props) => <button {...props} />,
  Switch: ({ checked, onCheckedChange, ...props }) => (
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />
  ),
  Select: ({ label, value, options, onChange }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
function fixture() {
  const media = new EventTarget()
  let devices: MediaDeviceInfo[] = []
  const enumerateDevices = vi.fn(async () => devices)
  vi.stubGlobal("navigator", { mediaDevices: Object.assign(media, { enumerateDevices }) })
  const preferences = defaultPreferences()
  const available = { vui: false, doubao: true }
  const host: VoiceSettingsHost = {
    load: vi.fn(async () => preferences),
    save: vi.fn(async () => {}),
    profiles: vi.fn(async () => ({ ...available })),
    saveCredential: vi.fn(async () => {}),
    deleteCredential: vi.fn(async (provider: Provider) => {
      available[provider] = false
    })
  }
  const onError = vi.fn(),
    onSaved = vi.fn()
  return {
    host,
    media,
    enumerateDevices,
    onError,
    onSaved,
    setDevices: (next: MediaDeviceInfo[]) => {
      devices = next
    },
    view: () =>
      render(<VoiceSettingsForm host={host} slots={slots} text={(key) => key} onError={onError} onSaved={onSaved} />)
  }
}
test("saving without a key commits settings and shows a reminder, while a configured key shows success", async () => {
  const native = settingsFixture()
  const profiles = { doubao: false, vui: false }
  vi.spyOn(commands, "voiceProfiles").mockImplementation(async () => profiles)
  fixture()
  render(<VoiceSection />)
  fireEvent.click(await screen.findByRole("button", { name: "voice.save" }))
  await waitFor(() => expect(notice.info).toHaveBeenCalledWith("voice.configureKey"))
  expect(notice.error).not.toHaveBeenCalled()
  expect(notice.success).not.toHaveBeenCalled()
  expect(native.write).toHaveBeenCalledOnce()
  expect(native.write.mock.calls[0][0].apiKey).toBeNull()
  profiles.doubao = true
  fireEvent.click(screen.getByRole("button", { name: "voice.save" }))
  await waitFor(() => expect(notice.success).toHaveBeenCalledWith("voice.saved"))
  expect(native.write).toHaveBeenCalledTimes(2)
  expect(notice.info).toHaveBeenCalledOnce()
})
test("shared settings revoke a key and refresh input devices without reopening", async () => {
  const f = fixture()
  f.view()
  const remove = await screen.findByRole("button", { name: "removeKey" })
  fireEvent.click(remove)
  await waitFor(() => expect(f.host.deleteCredential).toHaveBeenCalledWith("doubao"))
  await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole("button", { name: "removeKey" })).toBeNull()
  f.setDevices([{ deviceId: "usb", label: "USB microphone", kind: "audioinput", groupId: "g", toJSON: () => ({}) }])
  act(() => {
    f.media.dispatchEvent(new Event("devicechange"))
  })
  await waitFor(() => expect(document.body).toContainOneByRole("option", { name: "USB microphone" }))
  expect(f.onError).not.toHaveBeenCalled()
})
test("failed initial load offers a working retry rather than an endless loading indicator", async () => {
  const f = fixture()
  vi.mocked(f.host.load).mockRejectedValueOnce(new Error("locked"))
  f.view()
  fireEvent.click(await screen.findByRole("button", { name: "retry" }))
  await waitFor(() => expect(document.body).toContainOneByRole("button", { name: "save" }))
  expect(f.host.load).toHaveBeenCalledTimes(2)
})
test("invalid silence parameters prevent saving", async () => {
  const f = fixture()
  f.view()
  fireEvent.change(await screen.findByLabelText("mode"), { target: { value: "send" } })
  fireEvent.change(screen.getByLabelText("threshold"), { target: { value: "2" } })
  fireEvent.click(screen.getByRole("button", { name: "save" }))
  await waitFor(() => expect(f.onError).toHaveBeenCalledTimes(1))
  expect(f.host.save).not.toHaveBeenCalled()
})

test("device retry preserves edited provider and its credential", async () => {
  const f = fixture()
  f.view()
  fireEvent.change(await screen.findByLabelText("provider"), { target: { value: "vui" } })
  fireEvent.change(screen.getByLabelText("key"), { target: { value: "test-vui-key" } })
  f.enumerateDevices.mockRejectedValueOnce(new Error("device unavailable"))
  act(() => {
    f.media.dispatchEvent(new Event("devicechange"))
  })
  fireEvent.click(await screen.findByRole("button", { name: "retry" }))
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  expect(f.host.load).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole("button", { name: "save" }))
  await waitFor(() => expect(f.host.saveCredential).toHaveBeenCalledWith("vui", "test-vui-key"))
})

test("Doubao resource ID is editable and persisted, but hidden for VUI", async () => {
  const f = fixture()
  f.view()
  const input = await screen.findByLabelText("resourceId")
  expect(input).toHaveValue("volc.seedasr.sauc.duration")
  fireEvent.change(input, { target: { value: "volc.seedasr.sauc.concurrent" } })
  fireEvent.click(screen.getByRole("button", { name: "save" }))
  await waitFor(() =>
    expect(f.host.save).toHaveBeenCalledWith(
      expect.objectContaining({ doubaoResourceId: "volc.seedasr.sauc.concurrent" })
    )
  )
  await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByLabelText("provider"), { target: { value: "vui" } })
  expect(screen.queryByLabelText("resourceId")).toBeNull()
})

test("credential actions are inline and links follow the selected provider", async () => {
  const f = fixture()
  f.view()
  const key = await screen.findByLabelText("key")
  expect(document.body).toContainOneByText("removeKey")
  expect(document.body).toContainOneByText("save")
  expect(key.parentElement).toContainOneByRole("button", { name: "removeKey" })
  expect(screen.getByRole("link", { name: "getKey" })).toHaveAttribute(
    "href",
    "https://console.volcengine.com/speech/new/setting/apikeys"
  )
  fireEvent.change(screen.getByLabelText("provider"), { target: { value: "vui" } })
  expect(screen.getByRole("link", { name: "getKey" })).toHaveAttribute("href", "https://vuilabs.cn/api/api-keys")
})
test("clearing the resource ID restores and saves the default", async () => {
  const f = fixture()
  f.view()
  const input = await screen.findByLabelText("resourceId")
  fireEvent.change(input, { target: { value: "" } })
  fireEvent.blur(input)
  expect(input).toHaveValue("volc.seedasr.sauc.duration")
  fireEvent.change(input, { target: { value: "   " } })
  fireEvent.click(screen.getByRole("button", { name: "save" }))
  await waitFor(() =>
    expect(f.host.save).toHaveBeenCalledWith(
      expect.objectContaining({ doubaoResourceId: "volc.seedasr.sauc.duration" })
    )
  )
  expect(f.onError).not.toHaveBeenCalled()
})
