import { expect, vi, test } from "vitest"
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
import { navigationSoundStore } from "../codex/navigation-sound-store"
import { ChatWindow } from "@/features/chat-window/chat-window"
import { Composer } from "../composer"
import { drafts, importDraft } from "../composer/drafts"
import { DRAFT_SESSION_ID, DraftChat } from "../draft-chat"
import * as projectPicker from "../draft-project-picker"

vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...(await importOriginal<object>()) }))

// ACP uses native Web Streams; jsdom supplies only the browser surface.
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
    vi.spyOn(client, "connect").mockImplementation(() => real.connect()),
    vi.spyOn(client, "prepareDraft").mockImplementation((...args) => real.prepareDraft(...args)),
    vi.spyOn(client, "setConfig").mockImplementation((...args) => real.setConfig(...args)),
    vi.spyOn(client, "prompt").mockImplementation((...args) => real.prompt(...args)),
    vi.spyOn(core, "invoke").mockImplementation(async <T,>(command: string, args?: core.InvokeArgs): Promise<T> => {
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
      if (command === "plugin:window|is_focused" || command === "plugin:window|is_minimized") return false
      if (command === "plugin:window|is_visible") return !hidden
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
    vi.spyOn(chatWindow, "serveChatSurface").mockImplementation(async handler => {
      surface = handler
      return () => {
        surface = null
      }
    }),
    vi.spyOn(chatWindow, "announceChatReady").mockResolvedValue(),
    vi.spyOn(projectPicker, "chooseFolder").mockResolvedValue("/tmp/window-replacement"),
    vi.spyOn(client, "open").mockImplementation(async (id, cwd) => {
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
    const prompt = vi.spyOn(client, "prompt")
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
  vi.spyOn(client, "prompt").mockImplementation(async (...args) => {
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
  const failure = vi.spyOn(client, "prepareDraft").mockRejectedValueOnce(new Error("Preparation failed"))
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

test("choosing a gateway in a prepared draft preserves input and sends on a newly created target-model session", async () => {
  const { real, fake, restore } = await environment()
  fake.gateways.set("deepseek", {
    providerId: "openai",
    apiType: "openai",
    baseUrl: "https://example.test",
    _meta: { codex: { id: "deepseek", name: "DeepSeek" }, alwith: { models: [{ id: "deepseek-flash" }] } }
  })
  importDraft(DRAFT_SESSION_ID, {
    text: "preserve this question",
    mentions: ["/tmp/source.ts"],
    attachments: [],
    modelId: null
  })
  let selected: string | null = null
  const view = render(
    <DraftChat
      owner="main"
      cwd="/tmp/model-picker"
      onCwdChange={() => {}}
      onCreated={id => {
        selected = id
      }}
      onSendingChange={() => {}}
      onAuthRequired={() => {}}
      onNewChat={() => {}}
      providerSnapshot={providers}
    />
  )
  try {
    await waitFor(() => expect(view.getByRole("button", { name: "Send" })).not.toBeDisabled())
    const original = must<string>(selected, "original draft")
    await act(async () => fireEvent.click(view.getByTestId("model-trigger")))
    await act(async () => fireEvent.click(view.getByText("deepseek-flash")))
    await waitFor(() => expect(selected).not.toBe(original))
    await waitFor(() => expect(view.getByRole("button", { name: "Send" })).not.toBeDisabled())
    const replacement = must<string>(selected, "replacement draft")
    expect(fake.modelHints.get(replacement)).toBe("deepseek-flash")
    expect(fake.configChanges).toEqual([])
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("preserve this question")
    expect(drafts.get(replacement)?.mentions).toEqual(["/tmp/source.ts"])
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
    await waitFor(() => expect(real.session(replacement).items.some(item => item.kind === "user")).toBe(true))
    expect(fake.deleted.has(original)).toBe(true)
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
    vi.spyOn(client, "prompt").mockImplementation(async (id, prompt) => {
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

test("returning a floating draft transfers its input and releases the surface only after acceptance", async () => {
  const env = await windowEnvironment()
  const requests: { target: string; action: Parameters<typeof chatWindow.requestChatSurface>[1] }[] = []
  let reject = true
  const request = vi.spyOn(chatWindow, "requestChatSurface").mockImplementation(async (target, action) => {
    requests.push({ target, action })
    if (reject) throw new Error("Main window is busy")
    return null
  })
  importDraft(DRAFT_SESSION_ID, { text: "return this input", mentions: [], attachments: [], modelId: null })
  const view = render(
    <ThemeProvider>
      <ChatWindow preferences={windowPreferences} />
    </ThemeProvider>
  )
  try {
    await waitFor(() => expect(env.ready()).toBe(true))
    await act(() => env.present())
    await waitFor(() => expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("return this input"))
    const id = must(Object.keys(env.real.state.draftSessions)[0], "floating draft")
    const returnToMain = async (): Promise<void> => {
      await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions" })))
      await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Return to main window" })))
    }
    await returnToMain()
    expect(env.hidden).toBe(false)
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("return this input")
    reject = false
    await returnToMain()
    await waitFor(() => expect(env.hidden).toBe(true))
    expect(view.queryByRole("textbox")).toBeNull()
    expect(requests).toEqual(
      [0, 1].map(() => ({
        target: "main",
        action: {
          type: "present",
          transfer: {
            sessionId: id,
            cwd: windowPreferences.lastProjectDirectory,
            draft: { text: "return this input", mentions: [], attachments: [], modelId: null }
          }
        }
      }))
    )
  } finally {
    await act(async () => view.unmount())
    request.mockRestore()
    env.restore()
  }
})

test("extension drafts fill the mounted composer without sending and protect existing input", async () => {
  const { setComposerDraft } = await import("../composer/drafts")
  const { real, restore } = await environment()
  await real.connect()
  const id = await real.prepareDraft("main", "/tmp/extension-draft")
  const view = render(<Composer session={real.session(id)} />)
  try {
    await act(async () => setComposerDraft(id, "Review this before sending"))
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Review this before sending")
    expect(drafts.get(id)?.text).toBe("Review this before sending")
    expect(real.session(id).items.filter(item => item.kind === "user")).toHaveLength(0)
    expect(() => setComposerDraft(id, "replacement")).toThrow("草稿")
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Review this before sending")
    await act(async () => view.unmount())
    expect(() => setComposerDraft(id, "after close")).toThrow("输入框")
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test.each(["attachments", "mentions"] as const)("extension drafts preserve existing %s and model", async content => {
  const { setComposerDraft } = await import("../composer/drafts")
  const { real, restore } = await environment()
  await real.connect()
  const id = await real.prepareDraft("main", "/tmp/extension-draft")
  const original = {
    text: "",
    attachments:
      content === "attachments"
        ? [{ id: "image", type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,aW1hZ2U=" }]
        : [],
    mentions: content === "mentions" ? ["/tmp/report.md"] : [],
    modelId: "keep/model"
  }
  importDraft(id, original)
  const view = render(<Composer session={real.session(id)} />)
  try {
    expect(() => setComposerDraft(id, "replacement")).toThrow("草稿")
    expect(drafts.get(id)).toEqual(original)
    expect(real.session(id).items.filter(item => item.kind === "user")).toHaveLength(0)
  } finally {
    await act(async () => view.unmount())
    restore()
  }
})

test("packaged Plugin SDK fills the real U composer through the public chat bridge", async () => {
  const { ExtensionHost } = await import("@alwith/module-extension/host")
  const { extensionApiVersion } = await import("@alwith/module-extension")
  const { createPluginExtension, Plugin } = await import("@alwith/module-extension/plugin")
  const { createMemoryData } = await import("@alwith/module-extension/testing")
  const { createExtensionChatBridge } = await import("@/features/extensions/chat/bridge")
  const { setExtensionDraft, sendExtensionMessage } = await import("@/features/extensions/chat/chat")
  const { setComposerDraft } = await import("../composer/drafts")
  const { real, restore } = await environment()
  await real.connect()
  const id = await real.prepareDraft("main", "/tmp/extension-draft")
  const view = render(<Composer session={real.session(id)} />)
  let presented = false
  let application: import("@alwith/module-extension/plugin").PluginApp | undefined
  const dependencies = {
    session: (target: string) => (target === id ? { cwd: "/tmp/extension-draft" } : null),
    skills: async () => [],
    writeDraft: setComposerDraft,
    present: () => {
      presented = true
    },
    prompt: (target: string, text: string) => real.prompt(target, [{ type: "text", text }])
  }
  const chat = createExtensionChatBridge({
    check: () => {},
    session: () => ({ id, cwd: "/tmp/extension-draft", title: "Chat" }),
    send: (target, text) => sendExtensionMessage(target, text, [], dependencies),
    setDraft: (target, text) => setExtensionDraft(target, text, [], dependencies)
  })
  const host = new ExtensionHost({
    apiVersion: extensionApiVersion,
    capabilities: {
      "plugin.host": {
        version: "1.0.0",
        value: {
          ...chat,
          fetch: async () => new Response(""),
          captureChatContext: () => {},
          openView: () => {},
          notify: () => ({ hide() {}, setMessage() {} }),
          language: () => "en",
          primary: true,
          openExternal: async () => {},
          vault: { write: async () => {}, remove: async () => {} }
        }
      }
    },
    contributions: { commands: "1.0.0", surfaces: "1.0.0", settingsPages: "1.0.0" }
  })
  const manifest = {
    manifestVersion: 3 as const,
    id: "chat-fixture",
    name: "Chat",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.9" },
    hosts: {},
    dataSchemaVersion: 1
  }
  try {
    await host.activate(
      manifest,
      "fixture",
      context =>
        createPluginExtension(context, {
          manifest,
          create(_api, app, metadata) {
            application = app
            return new Plugin(app, metadata)
          }
        }),
      { data: createMemoryData(), resource: path => path }
    )
    const app = must(application, "plugin application")
    await act(async () => app.chat.setDraft("Draft from a plugin"))
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft from a plugin")
    expect(presented).toBe(true)
    expect(real.session(id).items.some(item => item.kind === "user")).toBe(false)
    await act(async () => app.chat.sendMessage("Send directly"))
    expect(real.session(id).items.some(item => item.kind === "user")).toBe(true)
    expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft from a plugin")
  } finally {
    await host.dispose()
    await act(async () => view.unmount())
    restore()
  }
})
