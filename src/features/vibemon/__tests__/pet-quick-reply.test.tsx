import { configureVibemon, type PetObservation, type VibemonHost } from "@alwith/module-auth/pets/core"
import { PetModeButton, PetQuickReply } from "@alwith/module-auth/pets/react"
import { SessionStateDot } from "@alwith/module-chat/session-list"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

let dispose = () => {}
afterEach(async () => {
  await act(() => {
    return Promise.try(() => {
      cleanup()
      dispose()
    })
  })
})
// React is loaded before the per-file DOM, selecting its legacy input plugin.
// Dispatch input handlers directly while retaining real React state and rendering.
function inputHandler(node: HTMLElement, name: string, event: unknown) {
  const key = Object.keys(node).find((key) => key.startsWith("__reactProps$"))
  if (key === undefined) throw new Error("Mounted input requires its React handlers")
  const props = (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[key]
  const handler = props[name]
  if (handler === undefined) throw new Error(`Missing input handler ${name}`)
  handler(event)
}
async function type(view: ReturnType<typeof render>, value: string) {
  const input = view.getByRole("textbox")
  await act(() => Promise.try(() => inputHandler(input, "onChange", { target: { value } })))
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
  const send = vi.fn(() => pending.promise)
  const answer = vi.fn(async () => {})
  const cancel = vi.fn(async () => {})
  const dismiss = vi.fn(async () => {})
  const panel = vi.fn(async () => {})
  const openChat = vi.fn(async () => {})
  const call = vi.fn((action: string, _payload?: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(action === "scale" ? 1 : undefined)
  )
  dispose = configureVibemon({
    account: () => ({ apiHost: "test", userId: "user", revision: 1 }),
    assets: {} as VibemonHost["assets"],
    storage: { get: () => Promise.resolve(undefined), set: async () => {} },
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => value,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      send,
      answer,
      cancel,
      dismiss,
      panel,
      openChat,
      activate: async () => {},
      select: async () => {}
    },
    windows: {
      call: <T,>(action: string, payload?: Record<string, unknown>) =>
        call(action, payload).then((value) => value as T),
      geometry: () => Promise.resolve(() => {}),
      moved: () => Promise.resolve(() => {}),
      openPet: () => Promise.resolve("shown"),
      closePet: async () => {},
      openRecharge: async () => {},
      commands: () => () => {}
    },
    onError: (error) => {
      throw error
    }
  })
  return {
    pending,
    value,
    cancel,
    dismiss,
    panel,
    send,
    answer,
    openChat,
    call,
    async update(patch: Partial<PetObservation>) {
      await act(() => {
        return Promise.try(() => {
          value = { ...value, ...patch }
          for (const listener of listeners) listener(value)
        })
      })
    }
  }
}
test("the input hides historical replies and submission acceptance does not show completion", async () => {
  const f = await fixture()
  const view = render(<PetQuickReply />)
  expect(view.queryByText("Previous answer")).toBeNull()
  await type(view, "New request")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Send" }))))
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(view.queryByRole("textbox")).toBeNull()
  await act(() => Promise.try(() => f.pending.resolve()))
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
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Allow once" }))))
  expect(f.answer).toHaveBeenCalledTimes(1)
  expect((view.getByRole("button", { name: "Allow once" }) as HTMLButtonElement).disabled).toBe(true)
})
test("complex questions and read-only ownership use the full conversation", async () => {
  const f = await fixture({
    state: "requires_action",
    prompt: { kind: "question", token: "q", title: "Question", detail: "More context", options: [] }
  })
  const view = render(<PetQuickReply />)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Open conversation to answer" }))))
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
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Send" }))))
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
  await act(() => Promise.try(() => f.pending.resolve()))
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
  expect(view.queryByText("Sent")).toBeNull()
})
test("IME confirmation never sends a message and Shift+Enter retains multiline editing", async () => {
  const f = await fixture()
  const view = render(<PetQuickReply />)
  const input = view.getByRole("textbox")
  await type(view, "你好")
  await act(() => {
    return Promise.try(() => {
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
  })
  expect(f.send).not.toHaveBeenCalled()
})
test("the collapse icon and loading state match Desktop and use the current language", async () => {
  await fixture()
  await initI18n("zh-CN")
  const view = render(<PetModeButton busy={false} onClick={() => {}} />)
  const button = view.getByRole("button", { name: "收起到 Vibémon" })
  expect(button.querySelector(".lucide-minimize-2")).not.toBeNull()
  view.rerender(<PetModeButton busy={true} onClick={() => {}} />)
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.querySelector(".animate-spin")).not.toBeNull()
})

test("task panel expands a stack and routes stopping and dismissal to the clicked task", async () => {
  const f = await fixture()
  const first = { ...f.value, state: "running" as const }
  const second = { ...first, title: "Second", binding: { ...first.binding, sessionId: "two" }, order: 2 }
  await f.update({ taskFeed: { tasks: [first, second], panel: "stacked", mainMinimized: false } })
  const view = render(<PetQuickReply />)
  fireEvent.click(view.getByRole("button", { name: "Expand tasks" }))
  expect(f.panel).toHaveBeenCalledWith("expanded")
  await f.update({ taskFeed: { tasks: [first, second], panel: "expanded", mainMinimized: false } })
  const secondCard = view.getByRole("region", { name: "Second" })
  const stop = secondCard.querySelector('button[aria-label="Stop task"]')
  if (stop === null) throw new Error("Missing stop action")
  await act(async () => fireEvent.click(stop))
  expect(f.cancel).toHaveBeenCalledWith(second.binding, expect.any(String))
  const dismiss = secondCard.querySelector('button[aria-label="Dismiss reminder"]')
  if (dismiss === null) throw new Error("Missing dismiss action")
  await act(async () => fireEvent.click(dismiss))
  expect(f.dismiss).toHaveBeenCalledWith(second.binding)
  expect(f.send).not.toHaveBeenCalled()
})

test("restoring the main window removes authorization buttons while retaining its normal task card", async () => {
  const f = await fixture()
  const first = {
    ...f.value,
    state: "requires_action" as const,
    prompt: {
      kind: "permission" as const,
      token: "permission",
      title: "Write file",
      detail: "",
      options: [{ id: "allow", label: "Allow" }]
    }
  }
  await f.update({ taskFeed: { tasks: [first], panel: "expanded", mainMinimized: true } })
  const view = render(<PetQuickReply />)
  expect(view.getByRole("button", { name: "Allow" })).toBeInTheDocument()
  await f.update({ taskFeed: { tasks: [first], panel: "expanded", mainMinimized: false } })
  expect(view.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument()
  expect(view.getByText("Write file")).toBeInTheDocument()
  expect(f.answer).not.toHaveBeenCalled()
  await f.update({ taskFeed: { tasks: [first], panel: "hidden", mainMinimized: true } })
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Allow" })))
  expect(f.answer).toHaveBeenCalledWith(first.binding, expect.any(String), "permission", "allow")
  await f.update({
    taskFeed: { tasks: [{ ...first, state: "running", prompt: null }], panel: "expanded", mainMinimized: true }
  })
  expect(view.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument()
  expect(view.getByText("Thinking")).toBeInTheDocument()
})

test.each([
  ["en", "Allow once", "Reject", "Permission request"],
  ["zh-CN", "允许一次", "拒绝", "权限请求"],
  ["ja", "今回のみ許可", "拒否", "承認が必要です"],
  ["ar", "السماح مرة واحدة", "رفض", "مطلوب إذن"]
])(
  "task permissions localize controls in %s and preserve the original answer IDs",
  async (language, allow, reject, title) => {
    const f = await fixture()
    await initI18n(language)
    const task: PetObservation = {
      ...f.value,
      state: "requires_action",
      prompt: {
        kind: "permission",
        token: "permission-test",
        title: "Run command?",
        detail: "Approval context",
        command: { text: "printf %s VIBEMON-TEST", cwd: "/project" },
        options: [
          { id: "protocol-allow-id", label: "Yes, proceed", decision: "allow" },
          { id: "protocol-reject-id", label: "No, and tell Codex what to do differently", decision: "reject" }
        ]
      }
    }
    await f.update({ taskFeed: { tasks: [task], panel: "hidden", mainMinimized: true } })
    const view = render(<PetQuickReply />)
    expect(view.getByText(title)).toBeVisible()
    expect(view.getByText("printf %s VIBEMON-TEST")).toBeVisible()
    expect(view.getByText("/project")).toBeVisible()
    expect(view.queryByText("Yes, proceed")).not.toBeInTheDocument()
    const rejectButton = view.getByRole("button", { name: reject })
    expect(rejectButton).toBeEnabled()
    await act(async () => fireEvent.click(view.getByRole("button", { name: allow })))
    expect(f.answer).toHaveBeenCalledWith(task.binding, expect.any(String), "permission-test", "protocol-allow-id")
    await act(async () => fireEvent.click(rejectButton))
    expect(f.answer).toHaveBeenLastCalledWith(task.binding, expect.any(String), "permission-test", "protocol-reject-id")
  }
)

test("opening a hidden task panel measures populated content without resize or animation callbacks", async () => {
  const f = await fixture()
  const task = { ...f.value, state: "done" as const }
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.matches(".pet-task-card") || this.querySelector(".pet-task-card") ? 180 : 0
    return { x: 0, y: 0, top: 0, left: 0, width: 328, height, right: 328, bottom: height, toJSON() {} }
  })
  const styles = document.createElement("style")
  styles.textContent =
    ".pet-task-panel { padding-bottom: 6px } .pet-task-content, .pet-task-card { border-top-left-radius: 28px }"
  document.head.append(styles)
  // A hidden WKWebView does not promise animation frames or ResizeObserver deliveries.
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1)
  try {
    await f.update({ taskFeed: { tasks: [task], panel: "hidden", mainMinimized: false } })
    const view = render(<PetQuickReply />)
    expect(view.queryByRole("region", { name: "First" })).toBeNull()
    f.call.mockClear()
    await f.update({ taskFeed: { tasks: [task], panel: "expanded", mainMinimized: false } })
    expect(view.getByRole("region", { name: "First" })).toBeInTheDocument()
    expect(f.call).toHaveBeenCalledWith("bubble-size", { width: 340, height: 180 })
    expect(f.call).toHaveBeenCalledWith(
      "bubble-blur",
      expect.objectContaining({ enabled: true, radius: 0, path: expect.any(Array) })
    )
    f.call.mockClear()
    await f.update({ taskFeed: { tasks: [task], panel: "hidden", mainMinimized: false } })
    expect(view.queryByRole("region", { name: "First" })).toBeNull()
    // Keep native presentation intact while the outgoing stage is still animating.
    expect(f.call).not.toHaveBeenCalledWith("bubble-blur", expect.objectContaining({ enabled: false }))
    f.call.mockClear()
    await f.update({ taskFeed: { tasks: [task], panel: "expanded", mainMinimized: false } })
    expect(f.call).toHaveBeenCalledWith("bubble-blur", expect.objectContaining({ enabled: true }))
  } finally {
    bounds.mockRestore()
    styles.remove()
    frame.mockRestore()
  }
})

test("task stages wait for native sizing and identical sizes do not re-present the window", async () => {
  const f = await fixture()
  const sized = Promise.withResolvers<void>()
  f.call.mockImplementation((action) =>
    action === "bubble-size" ? sized.promise : Promise.resolve(action === "scale" ? 1 : undefined)
  )
  const first = { ...f.value, state: "done" as const }
  const second = { ...first, title: "Second", binding: { ...first.binding, sessionId: "two" } }
  await f.update({ taskFeed: { tasks: [first, second], panel: "stacked", mainMinimized: false } })
  const view = render(<PetQuickReply />)
  expect(view.getByRole("button", { name: "Expand tasks" })).not.toBeVisible()
  expect(f.call.mock.calls.filter(([action]) => action === "bubble-size")).toHaveLength(1)
  await act(async () => sized.resolve())
  await waitFor(() => expect(view.getByRole("button", { name: "Expand tasks" })).toBeVisible())
  f.call.mockClear()
  await f.update({ taskFeed: { tasks: [first, second], panel: "expanded", mainMinimized: false } })
  expect(f.call.mock.calls.filter(([action]) => action === "bubble-size")).toHaveLength(0)
  expect(f.call).not.toHaveBeenCalledWith("bubble-blur", expect.objectContaining({ enabled: false }))
})

test("completed task capsules show a concise summary and clear collapsed reply drafts", async () => {
  const f = await fixture()
  const task = { ...f.value, state: "done" as const }
  await f.update({ taskFeed: { tasks: [task], panel: "expanded", mainMinimized: false } })
  const view = render(<PetQuickReply />)
  expect(view.getByText("Previous answer")).toBeInTheDocument()
  expect(view.queryByText("Completed")).not.toBeInTheDocument()
  expect(view.queryByRole("button", { name: "Collapse tasks" })).not.toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Continue conversation" }))
  const input = view.getByRole("textbox")
  expect(f.call).toHaveBeenCalledWith("focus", undefined)
  expect(input).toHaveFocus()
  await type(view, "Unsent draft")
  expect(input).toHaveValue("Unsent draft")
  fireEvent.click(view.getByRole("button", { name: "Continue conversation" }))
  expect(view.queryByRole("textbox")).not.toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Continue conversation" }))
  expect(view.getByRole("textbox")).toHaveValue("")
  expect(f.send).not.toHaveBeenCalled()
})

test("task capsules display their own latest request instead of a shared conversation title", async () => {
  const f = await fixture()
  const first = {
    ...f.value,
    title: "Test",
    state: "done" as const,
    userMessage: { messageId: "one", text: "Summarize\n the report", timestamp: 1 }
  }
  const second = {
    ...first,
    binding: { ...first.binding, sessionId: "two" },
    userMessage: { messageId: "two", text: "Review the changes", timestamp: 2 }
  }
  await f.update({ taskFeed: { tasks: [first, second], panel: "expanded", mainMinimized: false } })
  const view = render(<PetQuickReply />)
  expect(view.getByRole("region", { name: "Summarize the report" })).toBeInTheDocument()
  expect(view.getByRole("region", { name: "Review the changes" })).toBeInTheDocument()
  expect(view.queryByText("Test")).not.toBeInTheDocument()
  await f.update({
    taskFeed: {
      tasks: [{ ...first, userMessage: { messageId: "three", text: "Translate the summary", timestamp: 3 } }, second],
      panel: "expanded",
      mainMinimized: false
    }
  })
  expect(view.queryByRole("region", { name: "Summarize the report" })).not.toBeInTheDocument()
  expect(view.getByRole("region", { name: "Translate the summary" })).toBeInTheDocument()
  expect(view.getByRole("region", { name: "Review the changes" })).toBeInTheDocument()
})

test("the collapsed float shows only its task and replies to that binding after completion", async () => {
  const f = await fixture()
  const first = { ...f.value, state: "running" as const, order: 1 }
  const other = { ...first, title: "Other", binding: { ...first.binding, sessionId: "two" }, order: 2 }
  const feed = {
    tasks: [first, other],
    panel: "expanded" as const,
    mainMinimized: false,
    focusedSessionId: first.binding.sessionId
  }
  await f.update({ taskFeed: feed })
  const view = render(<PetQuickReply />)
  expect(view.getByRole("region", { name: "First" })).toBeInTheDocument()
  expect(view.queryByRole("region", { name: "Other" })).not.toBeInTheDocument()
  expect(view.getByRole("button", { name: "Continue conversation" })).toBeDisabled()
  await act(async () => fireEvent.click(view.getByRole("button", { name: /First/ })))
  expect(f.openChat).toHaveBeenCalledWith(first.binding)
  await f.update({ taskFeed: { ...feed, tasks: [{ ...first, state: "done" }, other] } })
  fireEvent.click(view.getByRole("button", { name: "Continue conversation" }))
  await type(view, "Continue this task")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })))
  expect(f.send).toHaveBeenCalledWith(first.binding, expect.any(String), "Continue this task")
  await act(async () => f.pending.resolve())
})

test("sidebar and task capsules share yellow running pulses and solid green unread completion", async () => {
  const f = await fixture()
  const task = { ...f.value, state: "running" as const }
  await f.update({ taskFeed: { tasks: [task], panel: "expanded", mainMinimized: false } })
  const view = render(
    <>
      <SessionStateDot state="running" title="Sidebar status" />
      <PetQuickReply />
    </>
  )
  const sidebar = view.getByTitle("Sidebar status")
  const capsule = view.getByLabelText("Running")
  expect(capsule.className).toBe(sidebar.className)
  expect(capsule).toHaveClass("text-yellow-500")
  expect(capsule.querySelector('[style*="--uib-size"]')).not.toBeNull()
  await f.update({ taskFeed: { tasks: [{ ...task, state: "done" }], panel: "expanded", mainMinimized: false } })
  expect(view.getByLabelText("Completed")).toHaveClass("bg-success", "rounded-full")
  expect(view.getByLabelText("Completed").querySelector('[style*="--uib-size"]')).toBeNull()
})
