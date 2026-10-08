import { expect, spyOn, test } from "bun:test"
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web"
import * as core from "@tauri-apps/api/core"
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { CodexClient } from "@/agent/client"
import { ThemeProvider } from "@/components/theme-provider"
import * as chatWindow from "@/lib/chat-window"
import { client, useApp, useSession } from "@/lib/client"
import { must } from "@/lib/__tests__/must"
import { initI18n } from "@/lib/i18n"
import type { ProviderSnapshot } from "@/lib/providers"
import type { Preferences } from "@/lib/preferences"
import { installDom } from "../codex/__tests__/dom-environment"
import { navigationSoundStore } from "../codex/navigation-sound-store"
import { Composer } from "../composer"
import { drafts, importDraft } from "../composer/drafts"
import { DRAFT_SESSION_ID, DraftChat } from "../draft-chat"
import * as projectPicker from "../draft-project-picker"

installDom()
// ACP uses native Web Streams; happy-dom supplies only the browser surface.
Object.assign(globalThis, { TransformStream, ReadableStream, WritableStream })
await initI18n("en")
const providers: ProviderSnapshot = {
  revision: 1,
  appliedRevision: 1,
  providers: {},
  customProviders: [],
  status: "applied",
  error: null
}

async function environment(nativeWindow = false) {
  const fake = createFakeAgent()
  const port = new FakeHubPort(() => fake.app)
  const real = new CodexClient(async () => port, { agentId: "codex", launch: { engine: "codex" } })
  const previous = client.state
  client.store.setState(real.state)
  const unsubscribe = real.store.subscribe(state => client.store.setState(state))
  const invokeHost = core.invoke
  const mocks = [
    spyOn(client, "connect").mockImplementation(() => real.connect()),
    spyOn(client, "prepareDraft").mockImplementation((...args) => real.prepareDraft(...args)),
    spyOn(client, "setConfig").mockImplementation((...args) => real.setConfig(...args)),
    spyOn(client, "prompt").mockImplementation((...args) => real.prompt(...args)),
    spyOn(core, "invoke").mockImplementation(async <T,>(command: string, args?: core.InvokeArgs): Promise<T> => {
      let result: unknown
      if (command === "draft_directory") result = (args as { cwd: string | null }).cwd ?? "/tmp/ALwith U"
      else if (command === "providers_apply" || command === "providers_read") result = providers
      else if (command === "read_apps_info") result = []
      else if (nativeWindow) return invokeHost<T>(command, args)
      else throw new Error(`Unexpected host command: ${command}`)
      return result as T
    })
  ]
  return {
    real,
    fake,
    restore: () => {
      unsubscribe()
      for (const mock of mocks) mock.mockRestore()
      real.disconnect()
      client.store.setState(previous, true)
      drafts.clear()
    }
  }
}

const windowPreferences: Preferences = {
  sidebarPinned: false,
  lastProjectDirectory: "/tmp/window-original",
  language: "en",
  zoomLevel: null,
  sessionModels: {},
  navigationSoundMode: "none",
  navigationInstrument: "acoustic_grand_piano",
  externalEditor: null
}

async function windowEnvironment() {
  const sound = navigationSoundStore.getState()
  navigationSoundStore.setState({ soundMode: "none" })
  mockWindows("chat")
  let hidden = true
  mockIPC(
    command => {
      if (command === "plugin:log|log") return
      if (command === "plugin:window|is_focused") return false
      if (command === "plugin:window|hide") {
        hidden = true
        return
      }
      if (command === "present_chat_window") {
        hidden = false
        return
      }
      throw new Error(`Unexpected window command: ${command}`)
    },
    { shouldMockEvents: true }
  )
  const env = await environment(true)
  type SurfaceHandler = Parameters<typeof chatWindow.serveChatSurface>[0]
  let surface: SurfaceHandler | null = null
  const mocks = [
    spyOn(chatWindow, "serveChatSurface").mockImplementation(async handler => {
      surface = handler
      return () => {
        surface = null
      }
    }),
    spyOn(chatWindow, "announceChatReady").mockResolvedValue(),
    spyOn(projectPicker, "chooseFolder").mockResolvedValue("/tmp/window-replacement"),
    spyOn(client, "open").mockImplementation(async (id, cwd) => {
      if (env.fake.deleted.has(id)) throw new Error("Cannot resume a deleted session")
      await env.real.open(id, cwd)
    })
  ]
  return {
    ...env,
    get hidden() {
      return hidden
    },
    async present(): Promise<void> {
      await must(surface, "window handler")({ type: "present" })
    },
    async release(id: string): Promise<chatWindow.ChatTransfer | null> {
      return await must(surface, "window handler")({ type: "release", sessionId: id })
    },
    ready: (): boolean => surface !== null,
    restore: (): void => {
      for (const mock of mocks) mock.mockRestore()
      env.restore()
      navigationSoundStore.setState(sound)
      clearMocks()
    }
  }
}

test("a hidden floating window reopens the replacement draft with its unsent input", async () => {
  const env = await windowEnvironment()
  const { ChatWindow } = await import("@/features/chat-window/chat-window")
  importDraft(DRAFT_SESSION_ID, { text: "keep this draft", mentions: [], attachments: [], modelId: null })
  let release: (() => void) | undefined
  env.fake.newSessionDelay.current = cwd =>
    cwd === "/tmp/window-replacement"
      ? new Promise(resolve => {
          release = resolve
        })
      : Promise.resolve()
  const view = render(
    <ThemeProvider>
      <ChatWindow preferences={windowPreferences} />
    </ThemeProvider>
  )
  try {
    await waitFor(() => expect(env.ready()).toBe(true))
    expect(env.fake.modelHints.size).toBe(0)
    await act(() => env.present())
    await waitFor(() => expect(view.getByRole("textbox")).toBeTruthy())
    const original = must(Object.keys(env.real.state.draftSessions)[0], "original draft")
    await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions" })))
    await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "New project" })))
    await waitFor(() => expect(release).toBeDefined())
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Close" })))
    expect(env.hidden).toBe(true)
    await act(async () => must(release, "pending replacement")())
    await waitFor(() => expect(env.fake.deleted.has(original)).toBe(true))
    await act(() => env.present())
    expect(env.hidden).toBe(false)
    await waitFor(() => expect(view.getByRole("textbox")).toBeTruthy())
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("keep this draft")
    expect(view.getByRole("button", { name: "window-replacement" })).toBeTruthy()
    const replacement = must(Object.keys(env.real.state.draftSessions)[0], "replacement draft")
    let transfer: chatWindow.ChatTransfer | null = null
    await act(async () => {
      transfer = await env.release(replacement)
    })
    expect(transfer).toMatchObject({ sessionId: replacement, cwd: "/tmp/window-replacement" })
    expect(env.hidden).toBe(true)
    expect(view.queryByRole("textbox")).toBeNull()
    expect(env.fake.modelHints.size).toBe(2)
  } finally {
    release?.()
    await act(async () => view.unmount())
    env.restore()
  }
})

test("a first message sent outside the composer opens the conversation and preserves unsent input", async () => {
  const env = await windowEnvironment()
  const { ChatWindow } = await import("@/features/chat-window/chat-window")
  importDraft(DRAFT_SESSION_ID, { text: "my unsent input", mentions: [], attachments: [], modelId: null })
  const view = render(
    <ThemeProvider>
      <ChatWindow preferences={windowPreferences} />
    </ThemeProvider>
  )
  try {
    await waitFor(() => expect(env.ready()).toBe(true))
    await act(() => env.present())
    await waitFor(() => expect(view.getByRole("textbox")).toBeTruthy())
    const id = must(Object.keys(env.real.state.draftSessions)[0], "draft")
    await act(() => env.real.prompt(id, [{ type: "text", text: "Message from extension" }]))
    await waitFor(() => expect(view.getByText("Message from extension")).toBeTruthy())
    expect(env.real.state.draftSessions[id]).toBeUndefined()
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("my unsent input")
  } finally {
    await act(async () => view.unmount())
    env.restore()
  }
})

test.each(["success", "failure", "unmount", "directory-change"] as const)(
  "preparation blocks submission through %s without losing or misrouting input",
  async outcome => {
    const { fake, real, restore } = await environment()
    let release: (() => void) | undefined
    fake.newSessionDelay.current = cwd =>
      cwd === "/tmp/slow-start"
        ? new Promise<void>((resolve, reject) => {
            release = () => (outcome === "failure" ? reject(new Error("Preparation failed")) : resolve())
          })
        : Promise.resolve()
    const prompt = spyOn(client, "prompt")
    const props = {
      owner: "main" as const,
      onCwdChange: () => {},
      onCreated: () => {},
      onSendingChange: () => {},
      onAuthRequired: () => {},
      onNewChat: () => {},
      providerSnapshot: providers
    }
    const view = render(<DraftChat {...props} cwd="/tmp/slow-start" />)
    try {
      await waitFor(() => expect(release).toBeDefined())
      const input = view.getByRole("textbox") as HTMLTextAreaElement
      expect(input.disabled).toBe(false)
      await act(async () => {
        fireEvent.focusIn(input)
        fireEvent.input(input, { target: { value: "send after preparation" } })
        fireEvent.keyUp(input, { key: "n" })
      })
      expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
      expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("true")
      expect(view.getByRole("button", { name: "Send" }).querySelector(".animate-spin")).not.toBeNull()
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Send" }))
        fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
        fireEvent.submit(must(input.form, "composer form"))
      })
      expect(prompt).not.toHaveBeenCalled()
      expect(input.value).toBe("send after preparation")
      expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
      if (outcome === "unmount") await act(async () => view.unmount())
      if (outcome === "directory-change") view.rerender(<DraftChat {...props} cwd="/tmp/other-project" />)
      await act(async () => must(release, "initial preparation")())
      if (outcome === "success") {
        await waitFor(() => expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false))
        expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("false")
        expect(view.getByRole("button", { name: "Send" }).querySelector(".animate-spin")).toBeNull()
        expect(prompt).not.toHaveBeenCalled()
        expect(input.value).toBe("send after preparation")
        await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
        await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
        const id = must(prompt.mock.calls[0], "sent prompt")[0]
        expect(id).not.toBe(DRAFT_SESSION_ID)
        expect(real.session(id).cwd).toBe("/tmp/slow-start")
        expect(real.session(id).items.some(item => item.kind === "user")).toBe(true)
        await waitFor(() => expect(input.value).toBe(""))
        expect(view.getByRole("textbox")).toBe(input)
      } else {
        if (outcome === "failure") {
          await waitFor(() => expect(view.getByRole("button", { name: "Retry" })).toBeTruthy())
          expect(view.getByRole("status").textContent).toContain("Internal error")
        }
        if (outcome === "directory-change")
          await waitFor(() => expect(view.getByRole("button", { name: "other-project" })).toBeTruthy())
        expect(prompt).not.toHaveBeenCalled()
        if (outcome !== "unmount") {
          expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("send after preparation")
          await waitFor(() =>
            expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(outcome === "failure")
          )
          expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("false")
        }
      }
    } finally {
      release?.()
      await act(async () => view.unmount())
      restore()
    }
  }
)

test("sending after default-directory resolution keeps the submitted conversation selected", async () => {
  const { fake, real, restore } = await environment()
  let accept!: () => void
  const receipt = new Promise<void>(resolve => {
    accept = resolve
  })
  spyOn(client, "prompt").mockImplementation(async (...args) => {
    await real.prompt(...args)
    await receipt
  })
  let release: (() => void) | undefined
  fake.newSessionDelay.current = () =>
    new Promise(resolve => {
      release = resolve
    })
  importDraft(DRAFT_SESSION_ID, { text: "first launch", mentions: [], attachments: [], modelId: null })
  let selected: string | null = null
  function Surface() {
    const [cwd, setCwd] = useState<string | null>(null)
    const [id, setId] = useState<string | null>(null)
    const [sendingId, setSendingId] = useState<string | null>(null)
    const draft = useApp(state => id === null || Boolean(state.draftSessions[id]))
    if (id && !draft && sendingId !== id) return <div data-testid="submitted">{id}</div>
    return (
      <DraftChat
        owner="main"
        cwd={cwd}
        onCwdChange={setCwd}
        onCreated={value => {
          selected = value
          setId(value)
        }}
        onSendingChange={(value, sending) => setSendingId(sending ? value : null)}
        onAuthRequired={() => {}}
        onNewChat={() => {}}
        providerSnapshot={providers}
      />
    )
  }
  const view = render(<Surface />)
  try {
    await waitFor(() => expect(release).toBeDefined())
    fake.newSessionDelay.current = null
    await act(async () => must(release, "default preparation")())
    await waitFor(() => expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false))
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
    await waitFor(() => expect(real.state.threads).toHaveLength(1))
    await waitFor(() => expect(view.queryByRole("status")).toBeNull())
    expect(fake.modelHints.size).toBe(1)
    expect(Object.keys(real.state.draftSessions)).toHaveLength(0)
    await act(async () => accept())
    await waitFor(() =>
      expect(view.getByTestId("submitted").textContent).toBe(must<string>(selected, "selected conversation"))
    )
    expect(fake.modelHints.size).toBe(1)
    expect(Object.keys(real.state.draftSessions)).toHaveLength(0)
    expect(real.session(must<string>(selected, "submitted session")).items.some(item => item.kind === "user")).toBe(
      true
    )
  } finally {
    release?.()
    accept()
    await act(async () => view.unmount())
    restore()
  }
})

test("the composer stays visible while initial providers and the native draft are loading", async () => {
  const { fake, real, restore } = await environment()
  importDraft(DRAFT_SESSION_ID, { text: "saved input", mentions: [], attachments: [], modelId: null })
  let release: (() => void) | undefined
  fake.newSessionDelay.current = () =>
    new Promise(resolve => {
      release = resolve
    })
  const props = {
    owner: "main" as const,
    cwd: "/tmp/initial-project",
    onCwdChange: () => {},
    onCreated: () => {},
    onSendingChange: () => {},
    onAuthRequired: () => {},
    onNewChat: () => {}
  }
  const view = render(<DraftChat {...props} providerSnapshot={null} />)
  try {
    const input = view.getByRole("textbox") as HTMLTextAreaElement
    expect(input.value).toBe("saved input")
    expect(input.disabled).toBe(false)
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("true")
    expect(view.queryByTestId("model-trigger")).toBeNull()
    expect(Object.keys(real.state.sessions)).toHaveLength(0)
    view.rerender(<DraftChat {...props} providerSnapshot={providers} />)
    await waitFor(() => expect(release).toBeDefined())
    expect(view.getByRole("textbox")).toBe(input)
    expect(input.disabled).toBe(false)
    await act(async () => must(release, "initial session creation")())
    await waitFor(() => expect(view.getByTestId("model-trigger")).toBeTruthy())
    expect(view.getByRole("textbox")).toBe(input)
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("saved input")
    expect(view.getByTestId("model-trigger").textContent).toContain("GPT-5.6 Sol")
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
    expect(Object.keys(real.state.sessions)).toHaveLength(1)
    expect(real.state.threads).toHaveLength(0)
  } finally {
    release?.()
    await act(async () => view.unmount())
    restore()
  }
})

test("initial preparation failure keeps the composer visible and retry preserves its draft", async () => {
  const { restore } = await environment()
  importDraft(DRAFT_SESSION_ID, { text: "retry input", mentions: [], attachments: [], modelId: null })
  const failure = spyOn(client, "prepareDraft").mockRejectedValueOnce(new Error("Preparation failed"))
  const view = render(
    <DraftChat
      owner="main"
      cwd="/tmp/retry"
      onCwdChange={() => {}}
      onCreated={() => {}}
      onSendingChange={() => {}}
      onAuthRequired={() => {}}
      onNewChat={() => {}}
      providerSnapshot={providers}
    />
  )
  try {
    await waitFor(() => expect(view.getByText("Preparation failed")).toBeTruthy())
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("retry input")
    expect((view.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false)
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("false")
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Retry" })))
    await waitFor(() => expect(view.getByTestId("model-trigger")).toBeTruthy())
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("retry input")
    expect(view.queryByText("Preparation failed")).toBeNull()
  } finally {
    await act(async () => view.unmount())
    failure.mockRestore()
    restore()
  }
})

test("new chat prepares once under StrictMode and exposes the real model before sending", async () => {
  const { fake, real, restore } = await environment()
  let selected: string | null = null
  function Surface() {
    const [cwd, setCwd] = useState<string | null>(null)
    return (
      <DraftChat
        owner="main"
        cwd={cwd}
        onCwdChange={setCwd}
        onCreated={id => {
          selected = id
        }}
        onSendingChange={() => {}}
        onAuthRequired={() => {
          throw new Error("Unexpected authentication")
        }}
        providerSnapshot={providers}
        onNewChat={() => {
          throw new Error("Unexpected new chat")
        }}
      />
    )
  }
  const view = render(
    <StrictMode>
      <Surface />
    </StrictMode>
  )
  try {
    await waitFor(() => expect(view.getByTestId("model-trigger").textContent).toContain("GPT-5.6 Sol"))
    await waitFor(() => expect(view.getByRole("textbox").hasAttribute("disabled")).toBe(false))
    expect(selected).not.toBeNull()
    expect(fake.modelHints.size).toBe(1)
    expect(real.session(must<string>(selected, "selected draft")).cwd).toBe("/tmp/ALwith U")
    expect(real.session(must<string>(selected, "selected draft")).items).toEqual([])
    expect(real.state.threads).toEqual([])
    await act(async () => fireEvent.click(view.getByTestId("model-trigger")))
    expect(view.getByRole("menuitemradio", { name: "GPT-5.6 Sol" })).toBeTruthy()
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test("first send clears persisted text and mentions before the normal composer mounts", async () => {
  const { real, restore } = await environment()
  importDraft(DRAFT_SESSION_ID, { text: "hello", mentions: ["/tmp/source.ts"], attachments: [], modelId: null })
  let prepared: string | null = null
  function Surface() {
    const [id, setId] = useState<string | null>(null)
    const [sending, setSending] = useState(false)
    const session = useSession(id)
    const draft = useApp(state => id === null || Boolean(state.draftSessions[id]))
    if (!draft && !sending && session) return <Composer session={session} />
    return (
      <DraftChat
        owner="main"
        cwd="/tmp/first-send"
        onCwdChange={() => {}}
        onCreated={value => {
          prepared = value
          setId(value)
        }}
        onSendingChange={(_id, sending) => setSending(sending)}
        onAuthRequired={() => {}}
        providerSnapshot={providers}
        onNewChat={() => {}}
      />
    )
  }
  const view = render(<Surface />)
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false))
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
    await waitFor(() => expect(real.state.draftSessions[must<string>(prepared, "prepared draft")]).toBeUndefined())
    await waitFor(() => expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""))
    expect(drafts.get(must<string>(prepared, "prepared draft"))?.mentions).toEqual([])
    expect(real.session(must<string>(prepared, "prepared draft")).items.some(item => item.kind === "user")).toBe(true)
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test("a queued directory failure retains the last successful replacement and its input", async () => {
  const { fake, real, restore } = await environment()
  importDraft(DRAFT_SESSION_ID, { text: "keep this input", mentions: [], attachments: [], modelId: null })
  let selected: string | null = null
  let release: (() => void) | undefined
  fake.newSessionDelay.current = cwd =>
    cwd === "/tmp/slow-project"
      ? new Promise(resolve => {
          release = resolve
        })
      : Promise.resolve()
  const props = {
    owner: "main" as const,
    onCwdChange: () => {},
    onCreated: (id: string) => {
      selected = id
    },
    onAuthRequired: () => {},
    onSendingChange: () => {},
    providerSnapshot: providers,
    onNewChat: () => {}
  }
  const view = render(<DraftChat {...props} cwd="/tmp/original" />)
  try {
    await waitFor(() => expect(selected).not.toBeNull())
    const original = must<string>(selected, "selected draft")
    view.rerender(<DraftChat {...props} cwd="/tmp/slow-project" />)
    await waitFor(() => expect(release).toBeDefined())
    view.rerender(<DraftChat {...props} cwd="/needs-auth" />)
    await act(async () => must(release, "pending session creation")())
    await waitFor(() => expect(view.getByRole("button", { name: "Configure provider" })).toBeTruthy())
    expect(selected).not.toBe(original)
    expect(real.session(must<string>(selected, "selected draft")).cwd).toBe("/tmp/slow-project")
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("keep this input")
    expect(fake.deleted.has(must<string>(selected, "selected draft"))).toBe(false)
    expect(Object.keys(real.state.draftSessions)).toEqual([must<string>(selected, "selected draft")])
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test.each([false, true])(
  "a failed first send preserves input and exits the draft only after dispatch: %s",
  async dispatched => {
    const { real, restore } = await environment()
    importDraft(DRAFT_SESSION_ID, { text: "keep for retry", mentions: [], attachments: [], modelId: null })
    spyOn(client, "prompt").mockImplementation(async (id, prompt) => {
      if (dispatched) await real.prompt(id, prompt)
      throw new Error("Request failed")
    })
    const sendingStates: boolean[] = []
    const view = render(
      <DraftChat
        owner="main"
        cwd="/tmp/lost-receipt"
        onCwdChange={() => {}}
        onCreated={() => {}}
        onSendingChange={(_id, sending) => {
          sendingStates.push(sending)
        }}
        onAuthRequired={() => {}}
        providerSnapshot={providers}
        onNewChat={() => {}}
      />
    )
    try {
      await waitFor(() => expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false))
      await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
      await waitFor(() => expect(view.getByRole("button", { name: /Send|Steer/ }).hasAttribute("disabled")).toBe(false))
      expect(sendingStates).toEqual([true, false])
      expect(Object.keys(real.state.draftSessions)).toHaveLength(dispatched ? 0 : 1)
      expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("keep for retry")
    } finally {
      await act(async () => view.unmount())
      restore()
    }
  }
)

test("a failed project change preserves the real draft and leaves the project picker usable", async () => {
  const { fake, real, restore } = await environment()
  let selected: string | null = null
  const props = {
    owner: "main" as const,
    onCwdChange: () => {},
    onCreated: (id: string) => {
      selected = id
    },
    onAuthRequired: () => {},
    onSendingChange: () => {},
    providerSnapshot: providers,
    onNewChat: () => {}
  }
  const view = render(<DraftChat {...props} cwd="/tmp/old-project" />)
  try {
    await waitFor(() => expect(selected).not.toBeNull())
    const original = must<string>(selected, "selected draft")
    view.rerender(<DraftChat {...props} cwd="/needs-auth" />)
    await waitFor(() => expect(view.getByRole("button", { name: "Configure provider" })).toBeTruthy())
    expect(real.state.draftSessions[original]).toBe("main")
    expect(fake.deleted.has(original)).toBe(false)
    expect(view.getByRole("button", { name: "old-project" }).hasAttribute("disabled")).toBe(false)
    view.rerender(<DraftChat {...props} cwd="/tmp/recovered-project" />)
    await waitFor(() => expect(selected).not.toBe(original))
    expect(real.session(must<string>(selected, "selected draft")).cwd).toBe("/tmp/recovered-project")
    expect(fake.deleted.has(original)).toBe(true)
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test("deleting a sent conversation does not resurrect startup placeholder input", async () => {
  const { fake, real, restore } = await environment()
  let release: (() => void) | undefined
  fake.newSessionDelay.current = () =>
    new Promise<void>(resolve => {
      release = resolve
    })
  const props = {
    owner: "main" as const,
    cwd: "/tmp/review-draft",
    onCwdChange: () => {},
    onCreated: () => {},
    onSendingChange: () => {},
    onAuthRequired: () => {},
    onNewChat: () => {},
    providerSnapshot: providers
  }
  let view = render(<DraftChat {...props} />)
  try {
    await waitFor(() => expect(release).toBeDefined())
    const input = view.getByRole("textbox") as HTMLTextAreaElement
    await act(async () => {
      fireEvent.input(input, { target: { value: "already sent text" } })
      fireEvent.keyUp(input, { key: "t" })
    })
    fake.newSessionDelay.current = null
    await act(async () => must(release, "prepare")())
    await waitFor(() => expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false))
    const id = must(Object.keys(real.state.draftSessions)[0], "draft")
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
    await waitFor(() => expect(real.state.draftSessions[id]).toBeUndefined())
    await waitFor(() => expect(input.value).toBe(""))
    await act(async () => view.unmount())
    await act(async () => real.delete(id))
    view = render(<DraftChat {...props} />)
    await waitFor(() => expect(view.getByTestId("model-trigger")).toBeTruthy())
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
  } finally {
    release?.()
    await act(async () => view.unmount())
    restore()
  }
})

test("switching writable conversations enables sending only for the selected conversation input", async () => {
  const { real, restore } = await environment()
  await real.connect()
  const first = await real.newSession("/tmp/first-conversation")
  const second = await real.newSession("/tmp/second-conversation")
  function Surface({ id }: { id: string }) {
    const session = must(useSession(id), "selected conversation")
    return <Composer key={id} session={session} />
  }
  const view = render(<Surface id={first} />)
  try {
    await act(async () => {
      fireEvent.input(view.getByRole("textbox"), { target: { value: "first draft" } })
      fireEvent.keyUp(view.getByRole("textbox"), { key: "t" })
    })
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
    view.rerender(<Surface id={second} />)
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true)
    await act(async () => {
      fireEvent.input(view.getByRole("textbox"), { target: { value: "second message" } })
      fireEvent.keyUp(view.getByRole("textbox"), { key: "e" })
    })
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
    await waitFor(() => expect(real.session(second).items.some(item => item.kind === "user")).toBe(true))
    expect(real.session(first).items.some(item => item.kind === "user")).toBe(false)
    view.rerender(<Surface id={first} />)
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("first draft")
    expect(view.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false)
    expect(view.getByRole("button", { name: "Send" }).getAttribute("aria-busy")).toBe("false")
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})
