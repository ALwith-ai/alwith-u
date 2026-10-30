import type { VoiceEvent, VoiceState } from "@alwith/module-voice"
import { prepareCapture } from "@alwith/module-voice/audio"
import { RevisionDraft } from "@alwith/module-voice/chat"
import { useVoiceInteraction } from "@alwith/module-voice/react"
import { createTauriTransport } from "@alwith/module-voice/tauri"
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, expect, test, vi } from "vitest"

import { must } from "@/lib/__tests__/must"

import type { VoiceSettings } from "../settings"
import { VoiceButton } from "../voice-button"
interface Callbacks {
  state(value: VoiceState): void
  partial(text: string): void
  final(text: string): void
  error(error: Error): void
}
const fake = vi.hoisted(() => ({
  instances: [] as { id: string; callbacks: Callbacks; finish: ReturnType<typeof vi.fn<() => Promise<string>>> }[],
  consume: null as ((bytes: Uint8Array) => void) | null,
  submit: vi.fn(),
  load: vi.fn(),
  report: vi.fn(),
  profiles: vi.fn(),
  openSettings: vi.fn(),
  voiceEnabled: true,
  cancelCapture: vi.fn(async () => {})
}))
vi.mock("@alwith/module-voice/tauri", () => ({
  createTauriTransport: () => ({
    start: (options: { recordingId: string }, receive: (event: VoiceEvent) => void) => {
      return Promise.try(() => {
        const id = options.recordingId
        const instance = {
          id,
          callbacks: {
            state: () => {},
            partial: (text: string) => receive({ type: "partial", recordingId: id, text }),
            final: (text: string) => receive({ type: "final", recordingId: id, text }),
            error: (error: Error) => receive({ type: "failed", recordingId: id, message: error.message })
          },
          finish: vi.fn(() => Promise.resolve(""))
        }
        fake.instances.push(instance)
        receive({ type: "ready", recordingId: id })
      })
    },
    push: async () => {},
    release: async () => {},
    cancel: async () => {},
    finish: async (id: string) => {
      const instance = fake.instances.find((item) => item.id === id)
      if (instance === undefined) throw new Error("missing recording")
      await instance.finish()
    }
  })
}))
vi.mock("@alwith/module-voice/audio", () => ({
  prepareCapture: () =>
    Promise.resolve({
      start: (consume: (bytes: Uint8Array) => void) => {
        fake.consume = consume
      },
      stop: async () => {},
      cancel: fake.cancelCapture
    })
}))
vi.mock("@alwith/module-chat/composer-context", () => ({ usePromptInputSubmission: () => fake.submit }))
vi.mock("@/features/chat/composer/prompt-input", () => ({
  PromptInputButton: (props: ComponentProps<"button">) => <button {...props} />
}))
vi.mock("@/lib/window-manager", () => ({ openSettingsWindow: fake.openSettings }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("sonner", () => ({ toast: { error: fake.report, info: vi.fn() } }))
vi.mock("../settings", () => ({
  loadVoiceSettings: fake.load,
  voiceProfiles: fake.profiles,
  hotwordsFor: () => []
}))
vi.mock("../use-voice-enabled", () => ({ useVoiceEnabled: () => fake.voiceEnabled }))
const settings: VoiceSettings = {
  provider: "doubao",
  deviceId: "",
  mode: "handsfree",
  hotwords: "",
  projectHotwords: {},
  smooth: false
}
beforeEach(() => {
  fake.voiceEnabled = true
  fake.cancelCapture.mockClear()
  fake.instances.length = 0
  fake.load.mockReset().mockResolvedValue(settings)
  fake.submit.mockReset()
  fake.report.mockClear()
  fake.profiles.mockReset().mockResolvedValue({ vui: true, doubao: true })
  fake.openSettings.mockClear()
})
test("disabling voice removes its controls and cancels an active recording", async () => {
  const props = {
    draft: new RevisionDraft("s", "", [0, 0]),
    cwd: "/tmp",
    enabled: true,
    cancelRef: { current: null },
    waitForTurn: async () => {},
    supportsHandsfree: true
  }
  const view = render(<VoiceButton {...props} />)
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await screen.findByRole("button", { name: "voice.stop" })
  fake.voiceEnabled = false
  view.rerender(<VoiceButton {...props} />)
  expect(screen.queryByRole("button")).toBeNull()
  await waitFor(() => expect(fake.cancelCapture).toHaveBeenCalled())
  const count = fake.instances.length
  fireEvent.keyDown(window, { key: "Alt", code: "AltLeft", altKey: true })
  fireEvent.keyUp(window, { key: "Alt", code: "AltLeft" })
  await act(async () => {})
  expect(fake.instances).toHaveLength(count)
})
test("the next handsfree recording has an enabled stop button and ignores old callbacks", async () => {
  const draft = new RevisionDraft("s", "", [0, 0])
  let endTurn!: () => void
  const completed = new Promise<void>((resolve) => {
    endTurn = resolve
  })
  fake.submit.mockImplementation(() => {
    return Promise.try(() => {
      draft.edit("", [0, 0])
      return { status: "accepted" }
    })
  })
  render(
    <VoiceButton
      draft={draft}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={() => completed}
      supportsHandsfree
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(fake.instances.length).toBe(1))
  const first = must(fake.instances[0], "first controller")
  act(() => {
    first.callbacks.state("succeeded")
    first.callbacks.final("hello")
  })
  await waitFor(() => expect(fake.submit).toHaveBeenCalledTimes(1))
  await act(async () => {
    endTurn()
    await completed
  })
  await waitFor(() => expect(fake.instances.length).toBe(2))
  const stop = screen.getByRole("button", { name: "voice.stop" })
  expect(stop).toBeEnabled()
  act(() => {
    first.callbacks.error(new Error("old"))
    first.callbacks.partial("obsolete")
    first.callbacks.state("failed")
  })
  expect(draft.read().text).toBe("")
  expect(fake.report).not.toHaveBeenCalled()
  fireEvent.click(stop)
  await waitFor(() => expect(must(fake.instances[1], "next controller").finish).toHaveBeenCalledTimes(1))
})
test("an existing draft explains why automatic voice sending is blocked", async () => {
  render(
    <VoiceButton
      draft={new RevisionDraft("existing", "unsent text", [11, 11])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(fake.report).toHaveBeenCalledWith("voice.existingDraft"))
  expect(fake.instances).toHaveLength(0)
  expect(fake.submit).not.toHaveBeenCalled()
})
test("a cancelled pending settings read cannot fail the next recording", async () => {
  let rejectOld!: (error: Error) => void
  fake.load.mockImplementationOnce(
    () =>
      new Promise<VoiceSettings>((_resolve, reject) => {
        rejectOld = reject
      })
  )
  render(
    <VoiceButton
      draft={new RevisionDraft("s", "", [0, 0])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  fireEvent.click(screen.getByRole("button", { name: "voice.cancel" }))
  // Pending setup has no controller yet; cancellation must restore an actionable idle state.
  await waitFor(() => expect(screen.getByRole("button", { name: "voice.start" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(fake.instances.length).toBe(1))
  await act(async () => {
    rejectOld(new Error("old setup"))
    await Promise.resolve()
  })
  expect(fake.report).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "voice.stop" })).toBeEnabled()
})

test("a late unconfigured profile cannot replace the active recording", async () => {
  let resolveOld!: (profiles: { vui: boolean; doubao: boolean }) => void
  fake.profiles.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  render(
    <VoiceButton
      draft={new RevisionDraft("s", "", [0, 0])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(fake.profiles).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole("button", { name: "voice.cancel" }))
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(fake.instances.length).toBe(1))
  await act(async () => {
    resolveOld({ vui: false, doubao: false })
    await Promise.resolve()
  })
  expect(fake.openSettings).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "voice.stop" })).toBeEnabled()
})
test("Desktop Option gesture starts on double tap, finishes on single tap and ignores repeats", async () => {
  fake.load.mockResolvedValue({ ...settings, mode: "dictation" })
  const view = render(
    <VoiceButton
      draft={new RevisionDraft("shortcut", "", [0, 0])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  const tap = (): void => {
    fireEvent.keyDown(window, { key: "Alt" })
    fireEvent.keyUp(window, { key: "Alt" })
  }
  tap()
  expect(fake.instances).toHaveLength(0)
  tap()
  await waitFor(() => expect(fake.instances).toHaveLength(1))
  await waitFor(() => expect(document.body).toContainOneByRole("button", { name: "voice.stop" }))
  fireEvent.keyDown(window, { key: "Alt" })
  fireEvent.keyDown(window, { key: "Alt", repeat: true })
  fireEvent.keyUp(window, { key: "Alt" })
  expect(must(fake.instances[0], "active recording").finish).not.toHaveBeenCalled()
  tap()
  await waitFor(() => expect(must(fake.instances[0], "active recording").finish).toHaveBeenCalledTimes(1))
  tap()
  tap()
  expect(fake.instances).toHaveLength(1)
  view.unmount()
  tap()
  tap()
  expect(fake.instances).toHaveLength(1)
})
test("Option chords and focus loss cannot arm recording", async () => {
  const props = {
    draft: new RevisionDraft("shortcut", "", [0, 0]),
    cwd: "/tmp",
    enabled: true,
    cancelRef: { current: null },
    waitForTurn: async () => {},
    supportsHandsfree: true
  }
  const view = render(<VoiceButton {...props} />)
  fireEvent.keyDown(window, { key: "Alt", ctrlKey: true })
  fireEvent.keyUp(window, { key: "Alt" })
  fireEvent.keyDown(window, { key: "Alt" })
  fireEvent.keyDown(window, { key: "c", altKey: true })
  fireEvent.keyUp(window, { key: "Alt" })
  fireEvent.keyDown(window, { key: "Alt" })
  fireEvent.keyUp(window, { key: "Alt" })
  fireEvent.blur(window)
  fireEvent.keyDown(window, { key: "Alt" })
  fireEvent.keyUp(window, { key: "Alt" })
  await act(async () => {})
  expect(fake.instances).toHaveLength(0)
  view.rerender(<VoiceButton {...props} enabled={false} />)
  for (let i = 0; i < 2; i++) {
    fireEvent.keyDown(window, { key: "Alt" })
    fireEvent.keyUp(window, { key: "Alt" })
  }
  await act(async () => {})
  expect(fake.instances).toHaveLength(0)
})

test("switching chats resets the shortcut to double-tap start", async () => {
  const props = {
    cwd: "/tmp",
    enabled: true,
    cancelRef: { current: null },
    waitForTurn: async () => {},
    supportsHandsfree: true
  }
  const view = render(<VoiceButton {...props} draft={new RevisionDraft("first", "", [0, 0])} />)
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  await waitFor(() => expect(document.body).toContainOneByRole("button", { name: "voice.stop" }))
  view.rerender(<VoiceButton {...props} draft={new RevisionDraft("second", "", [0, 0])} />)
  fireEvent.keyDown(window, { key: "Alt" })
  fireEvent.keyUp(window, { key: "Alt" })
  await act(async () => {})
  expect(fake.instances).toHaveLength(1)
  expect(document.body).toContainOneByRole("button", { name: "voice.start" })
})
test("a dialog blocks starting but cannot block finishing an active recording", async () => {
  fake.load.mockResolvedValue({ ...settings, mode: "dictation" })
  const props = {
    draft: new RevisionDraft("overlay", "", [0, 0]),
    cwd: "/tmp",
    enabled: true,
    cancelRef: { current: null },
    waitForTurn: async () => {},
    supportsHandsfree: true
  }
  const view = render(
    <>
      <VoiceButton {...props} />
      <div role="dialog" aria-label="Preview" />
    </>
  )
  const tap = (): void => {
    fireEvent.keyDown(window, { key: "Alt" })
    fireEvent.keyUp(window, { key: "Alt" })
  }
  tap()
  tap()
  await act(async () => {})
  expect(fake.instances).toHaveLength(0)
  view.rerender(<VoiceButton {...props} />)
  tap()
  tap()
  await waitFor(() => expect(document.body).toContainOneByRole("button", { name: "voice.stop" }))
  view.rerender(
    <>
      <VoiceButton {...props} />
      <div role="dialog" aria-label="Preview" />
    </>
  )
  tap()
  await waitFor(() => expect(must(fake.instances[0], "recording").finish).toHaveBeenCalledTimes(1))
})

test("headless interaction exposes recording state, final text, cancellation and cleanup", async () => {
  const draft = new RevisionDraft("headless", "", [0, 0])
  const transport = createTauriTransport({ invoke: vi.fn(), channel: vi.fn() })
  const options = {
    transport,
    capture: (_settings: unknown, signal: AbortSignal) =>
      prepareCapture({ deviceId: "", workletUrl: "/worklet.js" }, signal),
    enabled: true,
    host: {
      draft,
      canStart: () => true,
      supportsHandsfree: () => false,
      loadSettings: () =>
        Promise.resolve({
          provider: "doubao" as const,
          mode: "dictation" as const,
          deviceId: "",
          hotwords: [],
          smooth: false
        }),
      isConfigured: () => Promise.resolve(true),
      configure: async () => {},
      submit: () => Promise.resolve({ status: "accepted" as const }),
      waitForTurn: async () => {},
      onError: fake.report,
      onNoSpeech: vi.fn()
    }
  }
  const { result, rerender, unmount } = renderHook(useVoiceInteraction, { initialProps: options })
  expect(result.current.state).toEqual({ phase: "idle", waiting: false })
  await act(async () => {
    await result.current.start()
  })
  await waitFor(() => expect(result.current.state.phase).toBe("recording"))
  const first = must(fake.instances[0], "headless recording")
  act(() => first.callbacks.partial("hello"))
  expect(draft.read().text).toBe("hello")
  await act(async () => {
    const finishing = result.current.finish()
    first.callbacks.final("hello world")
    await finishing
  })
  expect(result.current.state.phase).toBe("succeeded")
  expect(draft.read().text).toBe("hello world")
  await act(async () => {
    await result.current.toggle()
  })
  await waitFor(() => expect(result.current.state.phase).toBe("recording"))
  act(() => must(fake.instances[1], "second recording").callbacks.partial("temporary"))
  act(() => result.current.cancel(true))
  expect(draft.read().text).toBe("hello world")
  expect(result.current.state.phase).toBe("cancelled")
  rerender({ ...options, enabled: false })
  await act(async () => {
    await result.current.start()
  })
  expect(fake.instances).toHaveLength(2)
  expect(fake.report).toHaveBeenCalledWith(expect.objectContaining({ message: "voice_unavailable" }))
  unmount()
  await expect(result.current.start()).rejects.toThrow("voice_interaction_not_mounted")
})

test("recording waveform follows microphone amplitude and disappears on cancel", async () => {
  render(
    <VoiceButton
      draft={new RevisionDraft("level", "", [0, 0])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
  const stop = await screen.findByRole("button", { name: "voice.stop" })
  const halo = must(document.querySelector("[data-voice-level]"), "recording waveform")
  expect(stop.contains(halo)).toBe(true)
  expect(stop.querySelector(".lucide-square")).toHaveClass("fill-current")
  expect(halo).toHaveAttribute("data-voice-level", "0")
  expect(halo).toHaveAttribute("aria-hidden", "true")
  expect(halo).toHaveAttribute("viewBox", "0 0 34 12")
  const quiet = new Uint8Array(4)
  new DataView(quiet.buffer).setInt16(0, 655, true)
  new DataView(quiet.buffer).setInt16(2, -655, true)
  act(() => must(fake.consume, "capture consumer")(quiet))
  const newest = must(halo.querySelector("rect:last-child"), "latest waveform sample")
  await waitFor(() => expect(Number(newest.getAttribute("height"))).toBeGreaterThan(3))
  expect(Number(newest.getAttribute("height"))).toBeLessThan(7)
  expect(Number(newest.getAttribute("opacity"))).toBeLessThan(0.5)
  const bytes = new Uint8Array([0, 64, 0, 192])
  act(() => must(fake.consume, "capture consumer")(bytes))
  expect(halo).toHaveAttribute("data-voice-level", "0.5")
  const bars = halo.querySelectorAll("rect")
  expect(bars).toHaveLength(7)
  await waitFor(() => expect(Number(bars[6].getAttribute("height"))).toBeGreaterThan(10))
  expect(Number(bars[6].getAttribute("opacity"))).toBeGreaterThan(0.7)
  await waitFor(() => expect(Number(bars[5].getAttribute("height"))).toBeGreaterThan(10))
  act(() => must(fake.consume, "capture consumer")(new Uint8Array(4)))
  expect(halo).toHaveAttribute("data-voice-level", "0")
  await waitFor(() => expect(bars[6]).toHaveAttribute("height", "3"))
  expect(bars[6]).toHaveAttribute("opacity", "0.2")
  fireEvent.click(screen.getByRole("button", { name: "voice.cancel" }))
  expect(document.querySelector("[data-voice-level]")).toBeNull()
  act(() => must(fake.consume, "capture consumer")(bytes))
  expect(document.querySelector("[data-voice-level]")).toBeNull()
})

test.each(["cancel", "finish"])("waveform receives fresh samples after %s and starting again", async (ending) => {
  fake.load.mockResolvedValue({ ...settings, mode: "dictation" })
  render(
    <VoiceButton
      draft={new RevisionDraft("repeat", "", [0, 0])}
      cwd="/tmp"
      enabled
      cancelRef={{ current: null }}
      waitForTurn={async () => {}}
      supportsHandsfree
    />
  )
  const bytes = new Uint8Array([0, 64, 0, 192])
  for (let attempt = 0; attempt < 3; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "voice.start" }))
    await screen.findByRole("button", { name: "voice.stop" })
    act(() => must(fake.consume, "capture consumer")(bytes))
    const waveform = must(document.querySelector("[data-voice-level]"), "waveform")
    expect(waveform).toHaveAttribute("data-voice-level", "0.5")
    await waitFor(() =>
      expect(Number(waveform.querySelector("rect:last-child")?.getAttribute("height"))).toBeGreaterThan(10)
    )
    if (ending === "cancel") fireEvent.click(screen.getByRole("button", { name: "voice.cancel" }))
    else {
      fireEvent.click(screen.getByRole("button", { name: "voice.stop" }))
      await act(() => Promise.try(() => must(fake.instances[attempt], "recording").callbacks.final("")))
      await screen.findByRole("button", { name: "voice.start" })
    }
    expect(document.querySelector("[data-voice-level]")).toBeNull()
  }
})
