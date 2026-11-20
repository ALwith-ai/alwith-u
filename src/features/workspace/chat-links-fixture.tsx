import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useState } from "react"
import { Toaster } from "sonner"

import { openChatWindowFile } from "@/features/chat-window/file-links"
import { CodexMarkdownRenderer } from "@/features/chat/codex/markdown-renderer"
import { ChatDirectoryContext, ChatOpenLocalLinkContext } from "@/features/chat/file-actions"
import { resolveDriveFileLink } from "@/features/drive/files"
import { MainSidebarLayout } from "@/features/layout/components/main-sidebar-layout"
import { serveChatSurface } from "@/lib/chat-window"

import { FileWorkspace } from "./file-workspace"

export function ChatLinksFixture({ directory, outside, web }: { directory: string; outside: string; web: string }) {
  const floating = getCurrentWebviewWindow().label === "chat"
  const [opened, setOpened] = useState("")
  useEffect(() => {
    if (floating) return
    const stop = serveChatSurface(async () => null, resolveDriveFileLink)
    return () => {
      void stop.then((dispose) => dispose())
    }
  }, [floating])
  const markdown = [
    "[Source link](source.txt:2:1)",
    "[Inside directory](folder)",
    `[Outside file](file://${encodeURI(outside)}/outside.txt#L2)`,
    `[Outside directory](file://${encodeURI(outside)})`,
    "[Local HTML](report.html)",
    `[Outside HTML](file://${encodeURI(outside)}/outside.html)`,
    "[PDF file](sample.pdf)",
    "[Image file](image.png)",
    "[Table file](table.csv)",
    "[Markdown file](notes.md)",
    "[Large file](large.txt)",
    "[Archive file](archive.zip)",
    "[Board file](project.canvas)",
    `[Web link](${web}?surface=${floating ? "chat" : "main"})`,
    "[Guide link](alwith-docs://guide/interface)",
    "[App bundle](/System/Applications/Calculator.app)",
    "[Missing file](missing.txt)"
  ].join("\n\n")
  const links = (
    <div className="overflow-y-auto p-4" data-chat-links-fixture>
      <ChatDirectoryContext value={directory}>
        <CodexMarkdownRenderer text={markdown} />
      </ChatDirectoryContext>
    </div>
  )
  if (floating) {
    return (
      <ChatOpenLocalLinkContext
        value={async (path) => {
          await openChatWindowFile(path, null)
          setOpened(path)
        }}
      >
        {links}
        <output data-system-opened={opened} />
        <Toaster />
      </ChatOpenLocalLinkContext>
    )
  }
  return (
    <>
      <MainSidebarLayout
        initialPinned={false}
        initialPaneOrder={["browser", "preview", "chat"]}
        screen="main"
        sidebar={null}
        leading={null}
        main={
          <FileWorkspace cwd={directory}>
            <button
              onClick={() =>
                new WebviewWindow("chat", { url: location.pathname + location.search, width: 500, height: 680 })
              }
            >
              Open fixture floating chat
            </button>
            {links}
          </FileWorkspace>
        }
      />
      <Toaster />
    </>
  )
}
