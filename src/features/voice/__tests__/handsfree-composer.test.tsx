import { createSession } from "@alwith/api"
import type { VoiceEvent } from "@alwith/module-voice"
import * as core from "@tauri-apps/api/core"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { Composer } from "@/features/chat/composer"
import { drafts } from "@/features/chat/composer/drafts"
import { DraftChat } from "@/features/chat/draft-chat"
import { client, useApp, useSession } from "@/lib/client"
import { initI18n } from "@/lib/i18n"
import { mockOf } from "@/test/mock-of"

import { useVoiceHandoff } from "../use-voice-handoff"

const fake = vi.hoisted(() => ({
  recordings: [] as { id: string; receive: (event: VoiceEvent) => void }[],
  error: vi.fn()
}))
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({ ...(await importOriginal<object>()) }))
vi.mock("@alwith/module-voice/tauri", () => ({
  createTauriTransport: () => ({
    start: (options: { recordingId: string }, receive: (event: VoiceEvent) => void) => {
      return Promise.try(() => {
        fake.recordings.push({ id: options.recordingId, receive })
        receive({ type: "ready", recordingId: options.recordingId })
      })
    },
    push: async () => {},
    release: async () => {},
    cancel: async () => {},
    finish: async () => {}
  })
}))
vi.mock("@alwith/module-voice/audio", () => ({
  prepareCapture: () => Promise.resolve({ start: () => {}, stop: async () => {}, cancel: async () => {} })
}))
vi.mock("../settings", () => ({
  loadVoiceSettings: () =>
    Promise.resolve({
      provider: "vui",
      deviceId: "",
      mode: "handsfree",
      hotwords: "",
      projectHotwords: {},
      smooth: false
    }),
  voiceProfiles: () => Promise.resolve({ vui: true, doubao: true })
}))
vi.mock("../use-voice-enabled", () => ({ useVoiceEnabled: () => true }))
vi.mock("sonner", () => ({ toast: { error: fake.error, info: vi.fn() } }))

await initI18n("en")
const original = client.state
beforeEach(() => {
  fake.recordings.length = 0
  fake.error.mockClear()
  client.store.setState({ sessions: { voice: { ...createSession("voice", "/tmp"), attached: true } } })
})
afterEach(() => {
  vi.restoreAllMocks()
  client.store.setState(original, true)
  drafts.clear()
})

function deferredAcceptance(): { accepted: Promise<void>; accept: () => void } {
  let accept!: () => void
  const accepted = new Promise<void>((resolve) => {
    accept = resolve
  })
  return { accepted, accept }
}

function renderComposer(): void {
  const session = client.store.getState().sessions.voice
  if (!session) throw new Error("missing session")
  render(<Composer session={session} />)
}

function transcribe(turn: number, type: "partial" | "final", text: string): void {
  const recording = fake.recordings[turn]
  if (!recording) throw new Error("missing recording")
  act(() => recording.receive({ type, recordingId: recording.id, text }))
}

test.each(["Check Shenzhen weather", "Check Shenzhen weather today"])(
  "handsfree clears accepted text and continues across turns with final text %s",
  async (finalText) => {
    const { accepted, accept } = deferredAcceptance()
    let receipts = 0
    const prompt = vi.spyOn(client, "promptReceipt").mockImplementation(async (id, content) => {
      await accepted
      const session = client.store.getState().sessions[id]
      if (!session) throw new Error("missing session")
      const receipt = `receipt-${++receipts}`
      client.store.setState({
        sessions: {
          [id]: {
            ...session,
            items: [
              ...session.items,
              { kind: "user", id: receipt, at: 1, replayed: false, echo: null, content, _meta: null }
            ]
          }
        }
      })
      return receipt
    })
    renderComposer()
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
    await screen.findByRole("button", { name: "Finish recording" })
    for (let turn = 0; turn < 2; turn++) {
      transcribe(turn, "partial", "Check Shenzhen weather")
      transcribe(turn, "final", finalText)
      await waitFor(() =>
        expect(prompt).toHaveBeenNthCalledWith(turn + 1, "voice", [{ type: "text", text: finalText }])
      )
      await act(async () => {
        accept()
        await accepted
      })
      await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""))
      act(() => {
        const current = client.store.getState().sessions.voice
        if (!current) throw new Error("missing session")
        client.store.setState({
          sessions: {
            voice: {
              ...current,
              turnEndedAt: { ...current.turnEndedAt, [`receipt-${turn + 1}`]: turn + 2 },
              lastStopReason: "end_turn"
            }
          }
        })
      })
      await waitFor(() => expect(fake.recordings).toHaveLength(turn + 2))
      expect(fake.error).not.toHaveBeenCalled()
    }
  }
)

test("typing while voice submission is pending preserves the new draft", async () => {
  const { accepted, accept } = deferredAcceptance()
  const prompt = vi.spyOn(client, "promptReceipt").mockImplementation(async () => {
    await accepted
    return "receipt"
  })
  renderComposer()
  fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
  await screen.findByRole("button", { name: "Finish recording" })
  transcribe(0, "final", "voice message")
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "my next message" } })
  await act(async () => {
    accept()
    await accepted
  })
  expect(screen.getByRole("textbox")).toHaveValue("my next message")
  expect(fake.recordings).toHaveLength(1)
  expect(fake.error).not.toHaveBeenCalled()
})

test("rejected voice submission preserves the recognized draft", async () => {
  vi.spyOn(client, "promptReceipt").mockRejectedValue(new Error("offline"))
  renderComposer()
  fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
  await screen.findByRole("button", { name: "Finish recording" })
  transcribe(0, "final", "retry this message")
  await waitFor(() => expect(fake.error).toHaveBeenCalledWith("offline"))
  expect(screen.getByRole("textbox")).toHaveValue("retry this message")
  expect(fake.recordings).toHaveLength(1)
})

test("a new chat can start handsfree and hand its accepted receipt to the conversation", async () => {
  const handoff = vi.fn()
  const session = client.store.getState().sessions.voice
  if (!session) throw new Error("missing session")
  const send = vi.fn((_prompt: unknown, accept?: (receipt: string) => void) => {
    return Promise.try(() => {
      client.store.setState({
        sessions: {
          voice: {
            ...session,
            items: [{ kind: "user", id: "first-receipt", at: 1, replayed: false, echo: null, content: [], _meta: null }]
          }
        }
      })
      accept?.("first-receipt")
    })
  })
  render(<Composer session={session} onSubmit={send} onVoiceHandoff={handoff} />)
  fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
  await screen.findByRole("button", { name: "Finish recording" })
  transcribe(0, "final", "first voice message")
  await waitFor(() => expect(handoff).toHaveBeenCalledWith("voice", "first-receipt"))
  expect(send).toHaveBeenCalledTimes(1)
  expect(fake.error).not.toHaveBeenCalled()
})

test.each(["complete", "cancel", "shortcut", "modified-shortcut", "blur-shortcut", "edit", "failure"])(
  "first-send handoff waits for its receipt and handles %s",
  async (outcome) => {
    const initial = client.store.getState().sessions.voice
    if (!initial) throw new Error("missing session")
    function Surface() {
      const [created, setCreated] = useState(false)
      const handoff = useVoiceHandoff("voice", 0)
      return created ? (
        <Composer key="conversation" session={initial} voiceResume={handoff.resume} />
      ) : (
        <Composer
          key="draft"
          session={initial}
          onVoiceHandoff={handoff.accept}
          onSubmit={(content, accept) => {
            return Promise.try(() => {
              client.store.setState({
                sessions: {
                  voice: {
                    ...initial,
                    items: [
                      { kind: "user", id: "first-receipt", at: 1, replayed: false, echo: null, content, _meta: null }
                    ]
                  }
                }
              })
              accept?.("first-receipt")
              drafts.delete("voice")
              setCreated(true)
            })
          }}
        />
      )
    }
    render(
      <StrictMode>
        <Surface />
      </StrictMode>
    )
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
    await screen.findByRole("button", { name: "Finish recording" })
    transcribe(0, "final", "first voice message")
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""))
    await waitFor(() => expect(screen.getByRole("button", { name: "Voice input" })).toBeDisabled())
    expect(fake.recordings).toHaveLength(1)
    if (outcome === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel voice input" }))
    if (outcome.endsWith("shortcut")) {
      fireEvent.keyDown(window, { key: "Alt", altKey: true, ctrlKey: outcome === "modified-shortcut" })
      if (outcome === "blur-shortcut") fireEvent.blur(window)
      fireEvent.keyUp(window, { key: "Alt" })
      if (outcome === "shortcut") {
        await waitFor(() => expect(screen.getByRole("button", { name: "Voice input" })).toBeEnabled())
      } else {
        expect(screen.getByRole("button", { name: "Voice input" })).toBeDisabled()
      }
    }
    if (outcome === "edit") fireEvent.change(screen.getByRole("textbox"), { target: { value: "new draft" } })
    act(() => {
      const session = client.store.getState().sessions.voice
      if (!session) throw new Error("missing session")
      client.store.setState({
        sessions: {
          voice: {
            ...session,
            turnEndedAt: { "first-receipt": 2 },
            lastStopReason: outcome === "failure" ? "cancelled" : "end_turn"
          }
        }
      })
    })
    if (["complete", "modified-shortcut", "blur-shortcut"].includes(outcome)) {
      await waitFor(() => expect(fake.recordings).toHaveLength(2))
      expect(screen.getByRole("button", { name: "Finish recording" })).toBeEnabled()
    } else {
      await waitFor(() => expect(screen.getByRole("button", { name: "Voice input" })).toBeEnabled())
      expect(fake.recordings).toHaveLength(1)
    }
    expect(screen.getByRole("textbox")).toHaveValue(outcome === "edit" ? "new draft" : "")
    if (outcome === "failure") expect(fake.error).toHaveBeenCalledWith("voice_turn_not_completed")
    else expect(fake.error).not.toHaveBeenCalled()
  }
)

test("cancelling a pending first send prevents a later accepted receipt from resuming voice", async () => {
  const { accepted, accept } = deferredAcceptance()
  const handoff = vi.fn()
  const session = client.store.getState().sessions.voice
  if (!session) throw new Error("missing session")
  const send = vi.fn(async (_prompt: unknown, onAccepted?: (receipt: string) => void) => {
    await accepted
    onAccepted?.("cancelled-receipt")
  })
  render(<Composer session={session} onSubmit={send} onVoiceHandoff={handoff} />)
  fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
  await screen.findByRole("button", { name: "Finish recording" })
  transcribe(0, "final", "first voice message")
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole("button", { name: "Cancel voice input" }))
  await act(async () => {
    accept()
    await accepted
  })
  expect(handoff).not.toHaveBeenCalled()
  expect(fake.recordings).toHaveLength(1)
  expect(fake.error).not.toHaveBeenCalled()
})

test("the real new-chat surface supplies its receipt and resumes after materializing the conversation", async () => {
  const providers = {
    revision: 1,
    appliedRevision: 1,
    providers: {},
    customProviders: [],
    status: "applied" as const,
    error: null
  }
  vi.spyOn(core, "invoke").mockImplementation(<T,>(command: string): Promise<T> => {
    return Promise.try(() => {
      const value: unknown =
        command === "draft_directory"
          ? "/tmp"
          : command === "providers_apply"
            ? providers
            : command === "read_apps_info"
              ? []
              : command === "settings_request"
                ? { revision: 1, values: {}, browserMigrated: true }
                : undefined
      if (value === undefined) throw new Error(`Unexpected host command: ${command}`)
      return value as T
    })
  })
  vi.spyOn(client, "connect").mockResolvedValue()
  vi.spyOn(client, "prepareDraft").mockResolvedValue("voice")
  vi.spyOn(client, "promptReceipt").mockImplementation((id, content) => {
    return Promise.try(() => {
      const session = client.store.getState().sessions[id]
      if (!session) throw new Error("missing session")
      client.store.setState({
        draftSessions: {},
        sessions: {
          [id]: {
            ...session,
            items: [{ kind: "user", id: "first-receipt", at: 1, replayed: false, echo: null, content, _meta: null }]
          }
        }
      })
      return "first-receipt"
    })
  })
  client.store.setState({ connection: "ready", draftSessions: { voice: "main" } })
  function Surface() {
    const [sending, setSending] = useState(false)
    const session = useSession("voice")
    const isDraft = useApp((state) => Boolean(state.draftSessions.voice))
    const handoff = useVoiceHandoff("voice", 0)
    if (!isDraft && !sending && session)
      return <Composer key="conversation" session={session} voiceResume={handoff.resume} />
    return (
      <DraftChat
        owner="main"
        cwd="/tmp"
        onCwdChange={() => {}}
        onCreated={() => {}}
        onSendingChange={(_id, pending) => setSending(pending)}
        onVoiceHandoff={handoff.accept}
        onAuthRequired={() => {
          throw new Error("Unexpected authentication")
        }}
        providerSnapshot={providers}
        onNewChat={() => {
          throw new Error("Unexpected new chat")
        }}
        runOperation={async (operation) => {
          await operation()
        }}
      />
    )
  }
  render(<Surface />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Voice input" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "Voice input" }))
  await screen.findByRole("button", { name: "Finish recording" })
  transcribe(0, "final", "first voice message")
  await waitFor(() =>
    expect(mockOf(client, "promptReceipt")).toHaveBeenCalledWith("voice", [
      { type: "text", text: "first voice message" }
    ])
  )
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""))
  act(() => {
    const session = client.store.getState().sessions.voice
    if (!session) throw new Error("missing session")
    client.store.setState({
      sessions: {
        voice: {
          ...session,
          turnEndedAt: { "first-receipt": 2 },
          lastStopReason: "end_turn"
        }
      }
    })
  })
  await waitFor(() => expect(fake.recordings).toHaveLength(2))
  expect(fake.error).not.toHaveBeenCalled()
})
