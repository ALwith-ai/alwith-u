import type { MessageItem, Terminal, ToolItem } from "@alwith/api"
import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { ActivityHostProvider, type ActivityHost } from "@alwith/module-chat/activity-host"
import { withChatResources } from "@alwith/module-chat/locales"
import { PatchView } from "@alwith/module-chat/patch-view"
import { TerminalOutput } from "@alwith/module-chat/terminal-output"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { createInstance } from "i18next"
import { projectActivity } from "../activity-projection"
import { installDom } from "./dom-environment"
import { must } from "@/lib/__tests__/must"

installDom()
const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
})
const translations = createInstance()
await translations.init({
  lng: "en",
  fallbackLng: "en",
  resources: withChatResources({}),
  interpolation: { escapeValue: false }
})
const openedImages: string[] = []
const host: ActivityHost = {
  t: (key, values) => translations.t(key, { ...values, ns: "alwithChat" }),
  i18n: { language: "en" },
  openLink: () => {},
  Markdown: ({ text }) => <p>{text}</p>,
  Output: TerminalOutput,
  Patch: ({ patch }) => <PatchView patch={patch} theme="light" />,
  openImage: url => openedImages.push(url),
  expandToolOutput: true
}

function tool(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    id: crypto.randomUUID(),
    at: 1,
    replayed: false,
    _meta: null,
    kind: "tool",
    name: "shell",
    title: "Run command",
    toolKind: "execute",
    status: "completed",
    content: [],
    locations: [],
    rawInput: { command: "echo hello" },
    rawOutput: null,
    endedAt: 2,
    ...overrides
  }
}
function display(item: MessageItem | ToolItem, terminals: Record<string, Terminal> = {}, streaming = false) {
  return (
    <ActivityHostProvider host={host}>
      <CodexActivityGroup blocks={[projectActivity(item, terminals, streaming)]} />
    </ActivityHostProvider>
  )
}
function mount(content: React.ReactElement) {
  const view = render(content)
  mounted.push(view)
  return view
}

test("real terminal data feeds the shared command card, with ANSI escaped and exit code retained", () => {
  const item = tool({
    content: [{ type: "terminal", terminalId: "term" }],
    rawInput: { command: ["echo", "hello"] },
    rawOutput: { output: "stale output" }
  })
  const terminal: Terminal = {
    id: "term",
    command: "echo hello",
    cwd: "/tmp",
    output: "\u001b[31m<script>hello</script>\u001b[0m",
    exitStatus: { exitCode: 2 }
  }
  const view = mount(display(item, { term: terminal }))
  fireEvent.click(view.getByRole("button", { name: "Ran echo hello" }))
  expect(view.getByText("<script>hello</script>")).toBeDefined()
  expect(view.container.querySelector("script")).toBeNull()
  expect(view.getByText("Exit code 2")).toBeDefined()
  expect(view.queryByText("stale output")).toBeNull()
  expect(item.rawInput).toEqual({ command: ["echo", "hello"] })
})

test("shared activity renders the original ACP patch instead of reducing it to a filename", () => {
  const patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old line\n+new line\n"
  const item = tool({
    name: "apply_patch",
    toolKind: "edit",
    locations: [{ path: "a.txt" }],
    rawInput: {},
    content: [{ type: "diff", changes: [{ path: "a.txt", operation: "modify" }], patch: { text: patch } }]
  })
  const view = mount(display(item))
  fireEvent.click(view.getByRole("button", { name: "Edited a.txt" }))
  expect(view.container.querySelector(".codex-patch-view")?.textContent).toContain("new line")
  expect(view.container.querySelector(".codex-patch-view")?.textContent).toContain("old line")
})

test("image results retain the application's lightbox action", () => {
  const item = tool({
    name: "view_image",
    toolKind: "read",
    rawInput: {},
    content: [{ type: "content", content: { type: "image", data: "aGVsbG8=", mimeType: "image/png" } }]
  })
  const view = mount(display(item))
  const picture = must(view.container.querySelector("img"), "the attached picture")
  fireEvent.click(must(picture.closest("button"), "the picture button"))
  expect(openedImages.at(-1)).toBe("data:image/png;base64,aGVsbG8=")
})

test("thinking identity survives message upserts and virtualized unmounts", () => {
  const item: MessageItem = {
    id: crypto.randomUUID(),
    kind: "thought",
    at: 1,
    replayed: false,
    _meta: null,
    echo: null,
    content: [{ type: "text", text: "First thought" }]
  }
  const view = mount(display(item, {}, true))
  const toggle = view.getByRole("button", { name: "Thinking" })
  fireEvent.click(toggle)
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  const updated = { ...item, content: [{ type: "text" as const, text: "First thought continued" }] }
  view.rerender(display(updated, {}, true))
  expect(view.getByRole("button", { name: "Thinking" }).getAttribute("aria-expanded")).toBe("false")
  view.unmount()
  const restored = mount(display(updated, {}, false))
  expect(restored.getByRole("button", { name: "Thought" }).getAttribute("aria-expanded")).toBe("false")
})

test("a heading-only reasoning summary stays visible when expanded", () => {
  const item: MessageItem = {
    id: crypto.randomUUID(),
    kind: "thought",
    at: 1,
    replayed: true,
    _meta: null,
    echo: null,
    content: [{ type: "text", text: "**Inspecting the repository**" }]
  }
  const view = mount(display(item))
  fireEvent.click(view.getByRole("button", { name: "Thought" }))
  expect(view.container.querySelector(".codex-reasoning-details")?.textContent).toBe("Inspecting the repository")
})

test("adding chat translations does not replace application strings", async () => {
  const instance = createInstance()
  await instance.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: withChatResources({ "zh-CN": { translation: { name: "ALwith U" } } })
  })
  expect(instance.t("name")).toBe("ALwith U")
  expect(instance.t("stream.codex.worked", { ns: "alwithChat" })).toBe("已处理")
})
