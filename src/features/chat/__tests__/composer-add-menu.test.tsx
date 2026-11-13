import { addPrompt, CodexClient, createSession } from "@alwith/module-chat/client"
import {
  Composer as SharedComposer,
  type ComposerProps,
  type ConversationHost,
  ConversationProvider,
  drafts
} from "@alwith/module-chat/conversation"
import { chatLocales } from "@alwith/module-chat/locales"
import { CodexMarkdownRenderer } from "@alwith/module-chat/markdown"
import { SessionTimeline } from "@alwith/module-chat/session-timeline"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import i18next from "i18next"
import { afterEach, expect, test, vi } from "vitest"

import { skillIconSrc } from "@/features/plugins/skill-icon"

const translations = i18next.createInstance()
await translations.init({ lng: "zh-CN", resources: { "zh-CN": { translation: chatLocales["zh-CN"] } } })
const client = new CodexClient(
  () => {
    throw new Error("Native Runtime is disabled in this test")
  },
  { agentId: "test", launch: { engine: "preview" } }
)
const host: ConversationHost = {
  t: (key, values) => translations.t(key, values ?? {}),
  i18n: { language: "zh-CN" },
  theme: "light",
  openLink: () => {},
  Markdown: ({ text }) => <p>{text}</p>
}
function Composer({ presentationHost = host, ...props }: ComposerProps & { presentationHost?: ConversationHost }) {
  return (
    <ConversationProvider client={client} host={presentationHost}>
      <SharedComposer {...props} predictions={false} />
    </ConversationProvider>
  )
}
afterEach(() => {
  vi.restoreAllMocks()
  drafts.clear()
})
const session = {
  ...createSession("add-menu", "/tmp"),
  attached: true,
  commands: [
    { type: "command" as const, name: "review", description: "Review changes", input: null },
    { type: "command" as const, name: "$deploy", description: "Ship a release", input: null }
  ]
}
async function open() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "添加附件、命令或应用" }))
  })
  await screen.findByRole("listbox", { name: "添加附件、命令或应用" })
}

test("the installed shared composer exposes one grouped picker", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: [
      { id: "sites", runtimeName: "Sites", enabled: true, callable: true },
      { id: "blocked", runtimeName: "Blocked", enabled: true, callable: false }
    ]
  } as Awaited<ReturnType<typeof client.installedApps>>)
  render(<Composer session={session} />)
  expect(screen.queryByRole("button", { name: "命令" })).toBeNull()
  expect(screen.queryByRole("button", { name: "应用" })).toBeNull()
  await open()
  expect(screen.getByText("附件与命令")).toBeInTheDocument()
  expect(screen.getByText("技能")).toBeInTheDocument()
  expect(await screen.findByRole("option", { name: "Sites" })).toBeInTheDocument()
  expect(screen.queryByText("Blocked")).toBeNull()
  expect(screen.getByRole("option", { name: /review/ }).closest('[role="group"]')).toBe(
    screen.getByRole("option", { name: "添加附件…" }).closest('[role="group"]')
  )
})

test("choosing a skill preserves its dollar marker and the draft without sending", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my text" } })
  await open()
  const skill = screen.getByRole("option", { name: /deploy/ })
  expect(skill).not.toHaveTextContent("$deploy")
  fireEvent.click(skill)
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Keep my text\n$deploy "))
  expect(screen.getByRole("textbox").querySelector('[data-inline-skill="$deploy"]')).toHaveTextContent("deploy")
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text: "Keep my text\n$deploy" }]))
})

test("app selection still submits a structured reference from the same picker", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: [{ id: "sites", runtimeName: "Sites", enabled: true, callable: true }]
  } as Awaited<ReturnType<typeof client.installedApps>>)
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  await open()
  fireEvent.click(await screen.findByRole("option", { name: "Sites" }))
  await waitFor(() => expect(screen.queryByRole("listbox", { name: "添加附件、命令或应用" })).toBeNull())
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      { type: "resource_link", name: "Sites", uri: "app://sites" },
      { type: "text", text: "[$Sites](app://sites)" }
    ])
  )
})

test("the attachment action opens the existing picker without sending the draft", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const submit = vi.fn(async () => {})
  const view = render(<Composer session={session} onSubmit={submit} />)
  const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
  const pick = vi.spyOn(fileInput, "click").mockImplementation(() => {})
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my draft" } })
  await open()
  fireEvent.click(screen.getByRole("option", { name: "添加附件…" }))
  expect(pick).toHaveBeenCalledOnce()
  expect(screen.getByRole("textbox")).toHaveValue("Keep my draft")
  expect(submit).not.toHaveBeenCalled()
})

test("keyboard selection inserts a command without letting Enter submit the form", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  await open()
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" })
  const command = screen.getByRole("option", { name: /review/ })
  await waitFor(() => expect(command).toHaveAttribute("aria-selected", "true"))
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("/review "))
  expect(submit).not.toHaveBeenCalled()
})

test("image creation surfaces keep their direct attachment action", () => {
  const view = render(<Composer session={session} agentControls={false} />)
  const pick = vi
    .spyOn(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, "click")
    .mockImplementation(() => {})
  fireEvent.click(screen.getByRole("button", { name: "添加图片" }))
  expect(pick).toHaveBeenCalledOnce()
  expect(screen.queryByRole("listbox", { name: "添加附件、命令或应用" })).toBeNull()
})

test("all entries are present immediately without search, separators or expansion", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: Array.from({ length: 9 }, (_, i) => ({
      id: `app-${i}`,
      runtimeName: `App ${i}`,
      enabled: true,
      callable: true
    }))
  })
  const commands = Array.from({ length: 12 }, (_, i) => ({
    type: "command" as const,
    name: `$skill-${i}`,
    description: "Skill"
  }))
  render(<Composer session={{ ...session, commands: [...session.commands, ...commands] }} />)
  await open()
  expect(screen.getByRole("option", { name: /skill-11/ })).toBeInTheDocument()
  expect(await screen.findByRole("option", { name: "App 8" })).toBeInTheDocument()
  expect(screen.queryByRole("combobox")).toBeNull()
  expect(screen.queryByRole("separator")).toBeNull()
  expect(screen.queryByText(/查看全部/)).toBeNull()
})

test("opening the add menu replaces slash suggestions and Escape keeps the draft focused", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  render(<Composer session={session} />)
  const input = screen.getByRole("textbox") as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: "/" } })
  act(() => {
    input.focus()
    input.setSelectionRange(1, 1)
    fireEvent.select(input)
  })
  await screen.findByRole("listbox")
  await open()
  expect(screen.getAllByRole("listbox")).toHaveLength(1)
  fireEvent.keyDown(input, { key: "Escape" })
  expect(screen.queryByRole("listbox", { name: "添加附件、命令或应用" })).toBeNull()
  expect(input).toHaveFocus()
  expect(input).toHaveValue("/")
})

test("slash shortcuts still filter and insert commands without submitting", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  const input = screen.getByRole("textbox") as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: "/rev" } })
  act(() => {
    input.focus()
    input.setSelectionRange(4, 4)
    fireEvent.select(input)
  })
  expect(await screen.findByRole("option", { name: /review/ })).toBeInTheDocument()
  expect(screen.queryByRole("option", { name: /deploy/ })).toBeNull()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("/review "))
  expect(submit).not.toHaveBeenCalled()
})

async function slash(query = "/") {
  const input = screen.getByRole("textbox") as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: query } })
  act(() => {
    input.focus()
    input.setSelectionRange(query.length, query.length)
    fireEvent.select(input)
  })
  await screen.findByRole("listbox")
  return input
}

test.each(["Please /rev", "帮我/rev", "First line\n/rev"])(
  "slash completion replaces the query after prose: %s",
  async (text) => {
    vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
    const submit = vi.fn(async () => {})
    render(<Composer session={session} onSubmit={submit} />)
    const input = await slash(text)
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue(`${text.slice(0, text.lastIndexOf("/"))}/review `)
    )
    expect(submit).not.toHaveBeenCalled()
  }
)

test("a skill selected after prose keeps its real invocation when switching editors", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  const input = await slash("帮我/dep")
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("帮我$deploy "))
  expect(screen.getByRole("textbox").querySelector("[data-inline-skill]")).toHaveTextContent("deploy")
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text: "帮我$deploy" }]))
})

test.each(["https://example.com/rev", "src/rev", "/tmp/rev"])(
  "URLs and paths do not open command completion: %s",
  (text) => {
    render(<Composer session={session} />)
    const input = screen.getByRole("textbox") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: text } })
    act(() => {
      input.focus()
      input.setSelectionRange(text.length, text.length)
      fireEvent.select(input)
    })
    expect(screen.queryByRole("listbox")).toBeNull()
  }
)

test("sent skill and application projections share the editor's reference appearance", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: [
      { id: "sites", runtimeName: "Sites", enabled: true, callable: true, iconUrl: "https://invalid.test/icon.png" }
    ]
  })
  const submit = vi.fn<NonNullable<ComposerProps["onSubmit"]>>(async () => {})
  const view = render(
    <Composer presentationHost={{ ...host, skillIcon: skillIconSrc }} session={session} onSubmit={submit} />
  )
  await open()
  fireEvent.click(screen.getByRole("option", { name: /deploy/ }))
  await waitFor(() => expect(screen.getByRole("textbox").querySelector("[data-inline-skill]")).not.toBeNull())
  await open()
  fireEvent.click(await screen.findByRole("option", { name: "Sites" }))
  const input = screen.getByRole("textbox")
  const skillClass = input.querySelector("[data-inline-skill]")!.className
  const appClass = input.querySelector("[data-inline-app]")!.className
  expect(input.querySelector("[data-inline-skill] img")).toHaveAttribute("src", skillIconSrc("deploy"))
  expect(input.querySelector("[data-inline-app] img")).toBeNull()
  expect(input.querySelectorAll("svg")).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  const content = submit.mock.calls[0]![0]
  view.unmount()
  const sent = addPrompt(session, content, "sent")
  const timeline = render(
    <SessionTimeline
      session={sent}
      client={client}
      host={{
        ...host,
        skillIcon: skillIconSrc,
        Markdown: ({ text }) => (
          <CodexMarkdownRenderer text={text} host={{ theme: "light", copyLabel: "Copy", openLink: () => {} }} />
        )
      }}
    />
  )
  await waitFor(() => expect(timeline.container.querySelector("[data-skill-reference]")).not.toBeNull())
  expect(timeline.container.querySelector("[data-skill-reference] > span")!.className).toBe(skillClass)
  expect(timeline.container.querySelector("[data-app-reference] > span")!.className).toBe(appClass)
  expect(timeline.container.querySelectorAll("[data-app-reference]")).toHaveLength(1)
  expect(timeline.container.querySelector("[data-skill-reference] img")).toHaveAttribute("src", skillIconSrc("deploy"))
  expect(timeline.container.querySelector("[data-app-reference] img")).toBeNull()
  expect(timeline.container.querySelector("[data-user-message-bubble]")).not.toHaveTextContent("$deploy")
})

test.each(["button", "slash"])("%s menu uses the skill page's canonical icon mapping", async (entry) => {
  vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
  const names = [
    "openai-docs",
    "imagegen",
    "alwith-docs",
    "skill-creator",
    "skill-installer",
    "review-agent",
    "unknown",
    "vendor:imagegen"
  ]
  render(
    <Composer
      presentationHost={{ ...host, skillIcon: skillIconSrc }}
      session={{
        ...session,
        commands: names.map((name) => ({ type: "command" as const, name: `$${name}`, description: "" }))
      }}
    />
  )
  if (entry === "button") await open()
  else await slash()
  for (const name of names) {
    const row = screen.getByRole("option", { name })
    expect(row.querySelector("img")).toHaveAttribute("src", skillIconSrc(name))
    expect(row).not.toHaveTextContent(`$${name}`)
  }
  fireEvent.click(screen.getByRole("option", { name: "imagegen" }))
  await waitFor(() =>
    expect(screen.getByRole("textbox").querySelector("[data-inline-skill] img")).toHaveAttribute(
      "src",
      skillIconSrc("imagegen")
    )
  )
  expect(screen.getByRole("textbox")).toHaveValue("$imagegen ")
})

test("slash groups commands, skills and callable apps in keyboard order", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: [
      { id: "sites", runtimeName: "Sites", enabled: true, callable: true },
      { id: "blocked", runtimeName: "Blocked", enabled: true, callable: false }
    ]
  })
  render(<Composer session={{ ...session, commands: session.commands.toReversed() }} />)
  const input = await slash()
  await screen.findByRole("option", { name: "Sites" })
  expect(screen.getByRole("group", { name: "命令" })).toContainElement(screen.getByRole("option", { name: /review/ }))
  expect(screen.getByRole("group", { name: "技能" })).toContainElement(screen.getByRole("option", { name: /deploy/ }))
  expect(screen.getByRole("group", { name: "应用" })).toContainElement(screen.getByRole("option", { name: "Sites" }))
  expect(screen.queryByRole("option", { name: "添加附件…" })).toBeNull()
  expect(screen.queryByText("Blocked")).toBeNull()
  fireEvent.keyDown(input, { key: "ArrowDown" })
  expect(screen.getByRole("option", { name: /deploy/ })).toHaveAttribute("aria-selected", "true")
  fireEvent.keyDown(input, { key: "ArrowDown" })
  expect(screen.getByRole("option", { name: "Sites" })).toHaveAttribute("aria-selected", "true")
})

test("slash app selection removes the query and submits the native application reference", async () => {
  vi.spyOn(client, "installedApps").mockResolvedValue({
    apps: [{ id: "sites", runtimeName: "Sites", enabled: true, callable: true }]
  })
  const submit = vi.fn(async () => {})
  render(<Composer session={session} onSubmit={submit} />)
  const input = await slash("/Sit")
  expect(await screen.findByRole("option", { name: "Sites" })).toBeInTheDocument()
  expect(screen.queryByRole("option", { name: /review/ })).toBeNull()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(drafts.get(session.id)?.apps).toMatchObject([{ id: "sites", name: "Sites" }]))
  expect(screen.getByRole("textbox")).toHaveValue("")
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      { type: "resource_link", name: "Sites", uri: "app://sites" },
      { type: "text", text: "[$Sites](app://sites)" }
    ])
  )
})

test("a failed slash app catalog leaves commands usable", async () => {
  const error = new Error("offline")
  const catalog = vi.spyOn(client, "installedApps").mockRejectedValue(error)
  vi.spyOn(console, "error").mockImplementation(() => {})
  render(<Composer session={session} />)
  const input = await slash()
  expect(await screen.findByText("应用读取失败")).toBeInTheDocument()
  fireEvent.keyDown(input, { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("/review "))
  expect(catalog).toHaveBeenCalledOnce()
})

test("a late app catalog cannot reopen a slash menu after typing ordinary text", async () => {
  let resolve!: (result: Awaited<ReturnType<typeof client.installedApps>>) => void
  vi.spyOn(client, "installedApps").mockImplementation(
    () =>
      new Promise((finish) => {
        resolve = finish
      })
  )
  render(<Composer session={session} />)
  const input = await slash()
  fireEvent.change(input, { target: { value: "keep" } })
  act(() => {
    input.setSelectionRange(4, 4)
    fireEvent.select(input)
  })
  await act(async () => resolve({ apps: [{ id: "sites", runtimeName: "Sites", enabled: true, callable: true }] }))
  expect(screen.queryByRole("listbox")).toBeNull()
  expect(input).toHaveValue("keep")
})

test.each(["button", "slash"])(
  "%s commands share the square-slash icon in menus, drafts and messages",
  async (entry) => {
    vi.spyOn(client, "installedApps").mockResolvedValue({ apps: [] })
    const submit = vi.fn<NonNullable<ComposerProps["onSubmit"]>>(async () => {})
    const view = render(<Composer session={session} onSubmit={submit} />)
    if (entry === "button") await open()
    else await slash("/rev")
    const row = screen.getByRole("option", { name: /review/ })
    expect(row.querySelector("svg")).toHaveClass("lucide-square-slash")
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByRole("textbox").querySelector("[data-inline-command]")).not.toBeNull())
    const input = screen.getByRole("textbox")
    expect(input).toHaveValue("/review ")
    const token = input.querySelector("[data-inline-command]")!
    const appearance = token.className
    expect(token).toHaveTextContent("review")
    expect(token.querySelector("svg rect")).toHaveAttribute("rx", "2")
    expect(token.querySelector("svg line")).toHaveAttribute("x1", "9")
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text: "/review" }]))
    const content = submit.mock.calls[0]![0]
    view.unmount()
    const sent = addPrompt(session, content, "sent-command")
    const timeline = render(
      <SessionTimeline
        session={sent}
        client={client}
        host={{
          ...host,
          Markdown: ({ text }) => (
            <CodexMarkdownRenderer text={text} host={{ theme: "light", copyLabel: "Copy", openLink: () => {} }} />
          )
        }}
      />
    )
    await waitFor(() => expect(timeline.container.querySelector("[data-command-reference]")).not.toBeNull())
    const projection = timeline.container.querySelector("[data-command-reference] > span")!
    expect(projection.className).toBe(appearance)
    expect(projection.querySelector("svg")).toHaveClass("lucide-square-slash")
    expect(projection).toHaveTextContent("review")
  }
)
