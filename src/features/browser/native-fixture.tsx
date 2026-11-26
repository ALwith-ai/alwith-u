import { invoke } from "@tauri-apps/api/core"
import { useCallback, useState } from "react"
/** Isolated native test entry: the actual browser pane, without auth or an agent runtime. */
import { createRoot } from "react-dom/client"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

import { BrowserWorkspace } from "./browser-workspace"
import { usePreviewRequest } from "./preview-request"
import { installQuickChatFixture } from "./quick-chat-fixture"
import "@/index.css"

// Native tool calls can outlive an inspector's evaluation timeout. Keep their result
// in the fixture DOM so contracts observe completion without replaying a mutation.
document.addEventListener("browser-contract-call", (event) => {
  const element = event.target
  if (!(element instanceof HTMLElement) || element.dataset.state !== "pending") return
  element.dataset.state = "running"
  const request: unknown = JSON.parse(element.textContent ?? "")
  if (
    !request ||
    typeof request !== "object" ||
    !("sessionId" in request) ||
    !("name" in request) ||
    typeof request.sessionId !== "string" ||
    typeof request.name !== "string" ||
    !request.name.startsWith("browser_")
  ) {
    element.textContent = JSON.stringify({ error: "Invalid browser contract request" })
    element.dataset.state = "done"
    return
  }
  void invoke("web_automation_execute", request as Record<string, unknown>)
    .then(
      (result) => {
        element.textContent = JSON.stringify({ result })
      },
      (error: unknown) => {
        element.textContent = JSON.stringify({ error: String(error) })
      }
    )
    .finally(() => {
      element.dataset.state = "done"
    })
})

function Fixture() {
  const [active, setActive] = useState(true)
  const show = useCallback(() => setActive(true), [])
  const request = usePreviewRequest(true, show)
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="p-2">Isolated native test · Browser workspace</header>
      {/* A closed pane is as the desktop shell leaves it: no wider than nothing, its content clipped. */}
      <div
        data-browser-pane
        className="flex min-h-0 flex-1 flex-col overflow-clip"
        style={active ? undefined : { width: 0 }}
      >
        <BrowserWorkspace
          active={active}
          maximized={false}
          onMaximize={() => {}}
          onClose={() => setActive(false)}
          request={request}
        />
      </div>
    </main>
  )
}
// The contract scripts ask for controls by their Chinese names.
await initI18n("zh-CN")
const parameters = new URLSearchParams(location.search)
const workspaceDirectory = parameters.get("html-preview-workspace")
const linksDirectory = parameters.get("chat-links-workspace")
let content
if (linksDirectory !== null) {
  const { ChatLinksFixture } = await import("../workspace/chat-links-fixture")
  const outside = parameters.get("outside")
  const web = parameters.get("web")
  if (!outside || !web) throw new Error("The chat link fixture needs outside and remote targets")
  if (parameters.get("browser-quick-links") === "1") {
    const next = new URL(web)
    next.searchParams.set("surface", "quick-chat")
    installQuickChatFixture({
      cwd: outside,
      reply: [
        `[Quick project file](file://${encodeURI(linksDirectory)}/folder/inside.txt#L2)`,
        "[Quick outside file](outside.txt:2:1)",
        `[Quick web link](${next.href})`
      ].join("\n\n")
    })
  }
  content = <ChatLinksFixture directory={linksDirectory} outside={outside} web={web} />
} else if (workspaceDirectory === null) {
  installQuickChatFixture()
  content = <Fixture />
} else {
  const { HtmlPreviewFixture } = await import("../workspace/html-preview-fixture")
  content = <HtmlPreviewFixture directory={workspaceDirectory} />
}
createRoot(document.getElementById("root")!).render(<ThemeProvider forced="light">{content}</ThemeProvider>)
