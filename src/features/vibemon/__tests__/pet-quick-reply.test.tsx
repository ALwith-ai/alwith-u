import { afterEach, expect, mock, test } from "bun:test"
import { configureVibemon, type PetObservation, type VibemonHost } from "@alwith/module-vibemon"
import { PetModeButton, PetQuickReply } from "@alwith/module-vibemon/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"

installDom()
let dispose = () => {}
afterEach(async () => {
  await act(async () => {
    cleanup()
    dispose()
  })
})
// React is loaded before the per-file DOM, selecting its legacy input plugin.
// Dispatch input handlers directly while retaining real React state and rendering.
function inputHandler(node: HTMLElement, name: string, event: unknown) {
  const key = Object.keys(node).find(key => key.startsWith("__reactProps$"))
  if (key === undefined) throw new Error("Mounted input requires its React handlers")
  const props = (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[key]
  const handler = props[name]
  if (handler === undefined) throw new Error(`Missing input handler ${name}`)
  handler(event)
}
async function type(view: ReturnType<typeof render>, value: string) {
  const input = view.getByRole("textbox")
  await act(async () => inputHandler(input, "onChange", { target: { value } }))
}
async function fixture(patch: Partial<PetObservation> = {}) {
  await initI18n("en")
  let value: PetObservation = {
    binding: {
      connectionEpoch: "epoch",
      agentId: "codex",
      sessionId: "one",
      incarnation: "instance",
      bindingRevision: 1
    },
    source: "event",
    revision: 1,
    state: "idle",
    since: 0,
    title: "First",
    cwd: "/project",
    windowLabel: "main",
    candidates: [{ sessionId: "one", title: "First", cwd: "/project", windowLabel: "main" }],
    owner: "owner",
    executionId: null,
    executionRole: null,
    access: "writable",
    surfaceVisible: false,
    error: null,
    reply: { messageId: "old", text: "Previous answer" },
    userMessage: null,
    prompt: null,
    ...patch
  }
  const listeners = new Set<(value: PetObservation | null) => void>()
  const pending = Promise.withResolvers<void>()
  const send = mock(() => pending.promise)
  const answer = mock(async () => {})
  const openChat = mock(async () => {})
  const call = mock(async <T,>(_action: string, _payload?: Record<string, unknown>) => undefined as T)
  dispose = configureVibemon({
    account: () => ({ apiHost: "test", userId: "user", revision: 1 }),
    assets: {} as VibemonHost["assets"],
    storage: { get: async () => undefined, set: async () => {} },
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => value,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      send,
      answer,
      openChat,
      activate: async () => {},
      select: async () => {}
    },
    windows: {
      call,
      geometry: async () => () => {},
      openPet: async () => "shown",
      closePet: async () => {},
      openRecharge: async () => {},
      commands: () => () => {}
    },
    onError: error => {
      throw error
    }
  })
  return {
    pending,
    send,
    answer,
    openChat,
    call,
    async update(patch: Partial<PetObservation>) {
      await act(async () => {
        value = { ...value, ...patch }
        for (const listener of listeners) listener(value)
      })
    }
  }
}
test("the input hides historical replies and submission acceptance does not show completion", async () => {
  const f = await fixture()
  const view = render(<PetQuickReply />)
  expect(view.queryByText("Previous answer")).toBeNull()
  await type(view, "New request")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(view.queryByRole("textbox")).toBeNull()
  await act(async () => f.pending.resolve())
  expect(view.getByRole("status").textContent).toBe("Sent")
  expect(view.queryByRole("img", { name: "Completed" })).toBeNull()
  const now = Date.now() + 10
  await f.update({
    state: "running",
    since: now,
    userMessage: { messageId: "user", text: "New request", timestamp: now }
  })
  expect(view.getByText("Thinking")).not.toBeNull()
  expect(view.queryByText("Previous answer")).toBeNull()
  await f.update({ state: "done", since: now + 1, reply: { messageId: "new", text: "New answer" } })
  expect(view.getByText("New answer")).not.toBeNull()
  expect(view.getByRole("img", { name: "Completed" })).not.toBeNull()
  fireEvent.click(view.getByRole("button", { name: "Continue conversation" }))
  expect(view.getByRole("textbox")).not.toBeNull()
})
test("approval detail and once-only buttons use the existing answer path without duplicate submission", async () => {
  const f = await fixture({
    state: "requires_action",
    prompt: {
      kind: "permission",
      token: "prompt",
      title: "Run?",
      detail: "command: ls",
      options: [{ id: "allow", label: "Allow once" }]
    }
  })
  const view = render(<PetQuickReply />)
  expect(view.getByText("command: ls")).not.toBeNull()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Allow once" })))
  expect(f.answer).toHaveBeenCalledTimes(1)
  expect((view.getByRole("button", { name: "Allow once" }) as HTMLButtonElement).disabled).toBe(true)
})
test("complex questions and read-only ownership use the full conversation", async () => {
  const f = await fixture({
    state: "requires_action",
    prompt: { kind: "question", token: "q", title: "Question", detail: "More context", options: [] }
  })
  const view = render(<PetQuickReply />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Open conversation to answer" })))
  expect(f.openChat).toHaveBeenCalledTimes(1)
  expect(f.answer).not.toHaveBeenCalled()
  await f.update({
    access: "readOnly",
    executionId: "execution",
    prompt: { kind: "question", token: "q2", title: "Question", detail: "", options: [{ id: "one", label: "One" }] }
  })
  expect(view.queryByRole("button", { name: "One" })).toBeNull()
  expect(view.getByRole("button", { name: "Open conversation to answer" })).not.toBeNull()
})
test("an in-flight reply cannot update a newly bound conversation", async () => {
  const f = await fixture()
  const view = render(<PetQuickReply />)
  await type(view, "Old draft")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
  await f.update({
    binding: {
      connectionEpoch: "epoch",
      agentId: "codex",
      sessionId: "two",
      incarnation: "instance2",
      bindingRevision: 2
    },
    title: "Second",
    reply: null
  })
  await act(async () => f.pending.resolve())
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
  expect(view.queryByText("Sent")).toBeNull()
})
test("IME confirmation never sends a message and Shift+Enter retains multiline editing", async () => {
  const f = await fixture()
  const view = render(<PetQuickReply />)
  const input = view.getByRole("textbox")
  await type(view, "你好")
  await act(async () => {
    inputHandler(input, "onCompositionStart", {})
    inputHandler(input, "onKeyDown", {
      key: "Enter",
      nativeEvent: { keyCode: 229, isComposing: true },
      preventDefault() {}
    })
    inputHandler(input, "onCompositionEnd", {})
    inputHandler(input, "onKeyDown", { key: "Enter", nativeEvent: {}, preventDefault() {} })
    inputHandler(input, "onKeyDown", { key: "Enter", shiftKey: true, nativeEvent: {}, preventDefault() {} })
  })
  expect(f.send).not.toHaveBeenCalled()
})
test("the collapse icon and loading state match Desktop and use the current language", async () => {
  await fixture()
  await initI18n("zh-CN")
  const view = render(<PetModeButton busy={false} onClick={() => {}} />)
  const button = view.getByRole("button", { name: "收起到 vibemon" })
  expect(button.querySelector(".lucide-minimize-2")).not.toBeNull()
  view.rerender(<PetModeButton busy={true} onClick={() => {}} />)
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.querySelector(".animate-spin")).not.toBeNull()
})
